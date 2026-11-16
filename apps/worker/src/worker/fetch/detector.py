from __future__ import annotations

from collections.abc import Mapping
from typing import Final

from selectolax.lexbor import LexborHTMLParser

_CHALLENGE_BODY_MARKERS: Final[tuple[str, ...]] = (
    "<title>just a moment...</title>",
    "attention required! | cloudflare",
    "cf-browser-verification",
    "challenges.cloudflare.com",
    "turnstile",
    "checking your browser",
    "enable javascript and cookies to continue",
    "please complete the security check",
    "ddos-guard",
    "incapsula",
    "perimeterx",
    "shieldsquare",
    "bot protection",
    "bot detection",
    "security check to access",
)

_ANTI_BOT_SERVERS: Final[tuple[str, ...]] = (
    "cloudflare",
    "ddos-guard",
    "akamai",
    "imperva",
    "incapsula",
    "sucuri",
)

_SPA_CONTAINER_SELECTORS: Final[tuple[str, ...]] = (
    "#root",
    "#app",
    "#__next",
    "#__nuxt",
    "main#app",
    "div[id='root']",
    "div[id='app']",
)

MAX_JS_ONLY_BODY_BYTES: Final[int] = 10 * 1024  # Empty shells are typically < 10KB
MIN_SUBSTANTIVE_TEXT_WORDS: Final[int] = 20


def is_html(content_type: str | None) -> bool:
    """Return True if content_type represents HTML."""
    if not content_type:
        return False
    ct = content_type.lower().split(";")[0].strip()
    return ct in ("text/html", "application/xhtml+xml")


def is_blocked_suspected(
    status_code: int,
    headers: Mapping[str, str],
    body: bytes | str = b"",
) -> bool:
    """Classify whether a response indicates anti-scraping / bot challenge blocking."""
    # 429 Too Many Requests is always a rate-limiting / scraper block
    if status_code == 429:
        return True

    if status_code not in (403, 503):
        return False

    # Check headers
    lower_headers = {k.lower(): v.lower() for k, v in headers.items()}
    if "cf-mitigated" in lower_headers and lower_headers["cf-mitigated"] == "challenge":
        return True

    # Cloudflare Ray ID on 403 or 503 is strongly indicative of Cloudflare edge challenge/block
    if "cf-ray" in lower_headers:
        return True

    server = lower_headers.get("server", "")
    has_antibot_server = any(ab in server for ab in _ANTI_BOT_SERVERS)

    # Check body markers
    if isinstance(body, bytes):
        body_text = body[:8192].decode("utf-8", errors="replace").lower()
    else:
        body_text = body[:8192].lower()

    if any(marker in body_text for marker in _CHALLENGE_BODY_MARKERS):
        return True

    if has_antibot_server and ("access denied" in body_text or "forbidden" in body_text):
        return True

    return False


def is_js_only_suspected(
    body: bytes | str,
    content_type: str | None = None,
) -> bool:
    """Detect whether HTML response is a tiny, empty JavaScript app shell (SPA)."""
    if content_type is not None and not is_html(content_type):
        return False

    raw_bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    if len(raw_bytes) > MAX_JS_ONLY_BODY_BYTES:
        return False

    try:
        parser = LexborHTMLParser(raw_bytes)
    except Exception:
        return False

    body_node = parser.body
    if body_node is None:
        return True

    text = body_node.text(strip=True)
    words = text.split()

    # If the page already has substantive text content, it's not an empty shell
    if len(words) >= MIN_SUBSTANTIVE_TEXT_WORDS:
        return False

    # Check for SPA mounting containers
    has_spa_container = any(parser.css_first(sel) is not None for sel in _SPA_CONTAINER_SELECTORS)

    # Check for noscript JavaScript warning
    noscript_nodes = parser.css("noscript")
    has_js_warning = any(
        "javascript" in (node.text(strip=True) or "").lower() for node in noscript_nodes
    )

    # Has script tag
    has_scripts = parser.css_first("script") is not None

    if (has_spa_container or has_js_warning) and (has_scripts or len(words) < 10):
        return True

    # Also detect completely empty body with script tags
    if len(words) == 0 and has_scripts:
        return True

    return False
