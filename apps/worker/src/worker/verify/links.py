"""Extract a placed link from one bounded HTML response."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urljoin

from selectolax.lexbor import LexborHTMLParser

from worker.fetch.types import FetchResult
from worker.urls.normalize import normalize_url


@dataclass(frozen=True)
class LinkCheck:
    status: str
    rel: list[str]
    final_url: str | None
    reason: str | None


def verify_link(fetch: FetchResult, target_url: str) -> LinkCheck:
    if fetch.outcome != "ok":
        if fetch.outcome == "http_4xx" and fetch.status_code in (404, 410):
            return LinkCheck("unverified", [], fetch.final_url, "source_missing")
        return LinkCheck("unknown", [], fetch.final_url, fetch.reason_code or fetch.outcome)
    target = normalize_url(target_url)
    if not target.ok:
        return LinkCheck("unknown", [], fetch.final_url, "invalid_target")
    tree = LexborHTMLParser((fetch.text or "")[: 2 * 1024 * 1024])
    for anchor in tree.css("a[href]"):
        destination = normalize_url(urljoin(fetch.final_url, anchor.attributes.get("href") or ""))
        if destination.ok and destination.normalized == target.normalized:
            rel = set((anchor.attributes.get("rel") or "").lower().split())
            labels = sorted(rel & {"nofollow", "sponsored", "ugc"}) or ["follow"]
            return LinkCheck("verified", labels, fetch.final_url, None)
    return LinkCheck("unverified", [], fetch.final_url, "link_missing")
