"""Registered-domain extraction (M3-S2).

The registered domain is the domain-level key for the domain cache, the
per-domain cap, the blocklist and the competitor gap.

Offline by design: `suffix_list_urls=()` makes tldextract use the public
suffix snapshot bundled in the package and never call the network at runtime.
Private suffixes are included, so `a.blogspot.com` and `b.blogspot.com` are
different registered domains.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

import tldextract

_EXTRACT = tldextract.TLDExtract(
    suffix_list_urls=(),
    cache_dir=None,
    include_psl_private_domains=True,
)


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return True


@lru_cache(maxsize=65_536)
def _registered_domain(host: str) -> str | None:
    if not host or "." not in host or _is_ip(host):
        return None
    ext = _EXTRACT(host)
    if not ext.domain or not ext.suffix:
        return None
    return f"{ext.domain}.{ext.suffix}"


def registered_domain(host: str) -> str | None:
    """Return the registered domain of an ASCII host, or None.

    None means: empty, single label (`localhost`, `intranet`), IP address,
    unknown suffix, or the host is itself a public suffix (`co.uk`).
    """
    return _registered_domain(host.strip().lower().rstrip("."))
