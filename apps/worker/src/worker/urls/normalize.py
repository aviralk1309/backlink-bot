"""URL normalization (M3-S1). Pure functions: no network, no database.

Rules (spec section 7, DEFAULT-ASSUMED choices marked D):
  * trim, reject empty, control characters and URLs over 2048 characters
  * scheme-less input ("example.com/x", "//example.com/x") is accepted
  * only http and https are accepted; the stored scheme is always https
  * host: lowercase, IDN to punycode, trailing dot removed, leading "www."
    removed (only while a registered domain remains, so "www.co.uk" survives)
  * hosts must be real domains: IP addresses, single-label hosts, unknown
    suffixes and underscores are rejected (D: the blocklist table has the
    same shape check)
  * userinfo and fragment are dropped
  * ports 80 and 443 are dropped, any other port is kept (D: dropped for both
    schemes so the result is stable after the scheme is unified)
  * path: percent-encoding normalized, dot segments resolved, trailing slash
    removed except for the root
  * query: percent-encoding normalized, tracking parameters removed, empty
    parts removed, remaining parts sorted (D1: stable dedup)
  * the original input is always kept as given
"""

from __future__ import annotations

import ipaddress
import re
import string
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from worker.urls.domain import registered_domain

MAX_URL_LENGTH = 2048

# Spec list. Any parameter starting with "utm_" is also removed.
DEFAULT_TRACKING_PARAMS: frozenset[str] = frozenset(
    {"gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "yclid", "igshid"}
)
_TRACKING_PREFIX = "utm_"

ErrorCode = Literal[
    "empty",
    "too_long",
    "bad_chars",
    "unsupported_scheme",
    "malformed",
    "no_host",
    "bad_host",
    "bad_port",
    "no_registered_domain",
]

_UNRESERVED = frozenset(string.ascii_letters + string.digits + "-._~")
_PATH_SAFE = _UNRESERVED | frozenset("!$&'()*+,;=:@/")
_QUERY_SAFE = _PATH_SAFE | frozenset("?")
_HEX = frozenset(string.hexdigits)

_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:")
_HOST_PORT_RE = re.compile(r"^[^/:?#@]+:\d+(?:[/?#]|$)")
_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_HOST_RE = re.compile(rf"{_LABEL}(?:\.{_LABEL})*")
_DROPPED_PORTS = frozenset({80, 443})


@dataclass(frozen=True, slots=True)
class NormalizedUrl:
    original: str
    normalized: str | None
    host: str | None
    registered_domain: str | None
    error: ErrorCode | None

    @property
    def ok(self) -> bool:
        return self.error is None


def _fail(raw: str, code: ErrorCode) -> NormalizedUrl:
    return NormalizedUrl(
        original=raw, normalized=None, host=None, registered_domain=None, error=code
    )


def _with_scheme(text: str) -> str:
    if "://" in text:
        return text
    if text.startswith("//"):
        return "http:" + text
    if _SCHEME_RE.match(text) and not _HOST_PORT_RE.match(text):
        return text  # mailto:, javascript:, data: ... rejected by the scheme check
    return "http://" + text


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _normalize_percent(text: str, safe: frozenset[str]) -> str:
    """Uppercase hex, decode unreserved characters, encode everything unsafe."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "%":
            pair = text[i + 1 : i + 3]
            if len(pair) == 2 and all(c in _HEX for c in pair):
                decoded = chr(int(pair, 16))
                out.append(decoded if decoded in _UNRESERVED else "%" + pair.upper())
                i += 3
                continue
            out.append("%25")
        elif ch in safe:
            out.append(ch)
        else:
            out.extend(f"%{b:02X}" for b in ch.encode("utf-8", errors="replace"))
        i += 1
    return "".join(out)


def _remove_dot_segments(path: str) -> str:
    out: list[str] = []
    for seg in path.split("/")[1:]:
        if seg == ".":
            continue
        if seg == "..":
            if out:
                out.pop()
            continue
        out.append(seg)
    return "/" + "/".join(out)


def _normalize_query(query: str, tracking: frozenset[str]) -> str:
    if not query:
        return ""
    kept: list[tuple[str, str]] = []
    for piece in _normalize_percent(query, _QUERY_SAFE).split("&"):
        if not piece:
            continue
        key = piece.split("=", 1)[0]
        lowered = key.lower()
        if lowered.startswith(_TRACKING_PREFIX) or lowered in tracking:
            continue
        kept.append((key, piece))
    kept.sort()
    return "&".join(piece for _, piece in kept)


def normalize_url(
    raw: str,
    *,
    tracking_params: frozenset[str] = DEFAULT_TRACKING_PARAMS,
) -> NormalizedUrl:
    """Normalize one URL. Never raises; failures come back as `error`."""
    text = raw.strip()
    if not text:
        return _fail(raw, "empty")
    if len(text) > MAX_URL_LENGTH:
        return _fail(raw, "too_long")
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in text):
        return _fail(raw, "bad_chars")

    try:
        parts = urlsplit(_with_scheme(text))
    except ValueError:  # bad IPv6 brackets and similar
        return _fail(raw, "malformed")
    if parts.scheme.lower() not in ("http", "https"):
        return _fail(raw, "unsupported_scheme")
    host = parts.hostname
    if not host:
        return _fail(raw, "no_host")
    try:
        port = parts.port  # raises on non-numeric or out-of-range ports
    except ValueError:
        return _fail(raw, "bad_port")
    if port is not None and port < 1:
        return _fail(raw, "bad_port")

    host = host.rstrip(".")
    if not host:
        return _fail(raw, "bad_host")
    if _is_ip(host):
        return _fail(raw, "no_registered_domain")
    try:
        host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        return _fail(raw, "bad_host")
    if len(host) > 253 or not _HOST_RE.fullmatch(host):
        return _fail(raw, "bad_host")
    if registered_domain(host) is None:
        return _fail(raw, "no_registered_domain")
    while host.startswith("www.") and registered_domain(host[4:]) is not None:
        host = host[4:]
    reg = registered_domain(host)

    path = _normalize_percent(parts.path, _PATH_SAFE)
    path = _remove_dot_segments(path or "/").rstrip("/") or "/"
    query = _normalize_query(parts.query, tracking_params)

    authority = host if port is None or port in _DROPPED_PORTS else f"{host}:{port}"
    normalized = f"https://{authority}{path}" + (f"?{query}" if query else "")
    return NormalizedUrl(
        original=raw, normalized=normalized, host=host, registered_domain=reg, error=None
    )


def normalize_domain(raw: str) -> str | None:
    """Registered domain for a domain or URL typed by a person, or None.

    Used for blocklist and competitor entries: "https://www.Spam.com/page",
    "SPAM.com" and "spam.com." all give "spam.com".
    """
    return normalize_url(raw).registered_domain
