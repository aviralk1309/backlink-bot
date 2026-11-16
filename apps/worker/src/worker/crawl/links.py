"""Select a few same-site links from a fetched landing page, without fetching them."""

from urllib.parse import unquote, urlsplit

from worker.checks.page import Page, contains, tokens
from worker.urls.normalize import normalize_url

ROUTES = (
    ("write for us", 6),
    ("contribute", 5),
    ("resources", 5),
    ("useful links", 5),
    ("partners", 4),
    ("guest post", 4),
)
TRAPS = {
    "search",
    "login",
    "signup",
    "calendar",
    "events",
    "tag",
    "category",
    "page",
    "wp-admin",
    "api",
}


def crawl_candidates(
    page: Page, source_url: str, domain: str, keywords: list[str]
) -> list[dict[str, str]]:
    source = normalize_url(source_url)
    if not source.ok or source.host is None or source.normalized is None:
        return []
    topic = {word for phrase in keywords for word in tokens(phrase) if len(word) >= 4}
    ranked: list[tuple[int, str, dict[str, str]]] = []
    seen: set[str] = set()
    for url, label in page.internal_links:
        parts = urlsplit(url)
        path = unquote(parts.path).casefold()
        segments = [part for part in path.split("/") if part]
        if parts.query or len(segments) > 6 or any(part in TRAPS for part in segments):
            continue
        if path.endswith((".pdf", ".jpg", ".png", ".xml", ".zip")):
            continue
        normalized = normalize_url(url)
        if (
            not normalized.ok
            or normalized.host is None
            or normalized.normalized is None
            or normalized.registered_domain is None
            or normalized.host != source.host
            or normalized.registered_domain != domain
            or normalized.normalized == source.normalized
            or normalized.normalized in seen
        ):
            continue
        text = f"{path.replace('-', ' ')} {label}"
        route = max((weight for phrase, weight in ROUTES if contains(text, phrase)), default=0)
        topic_hits = len(topic.intersection(tokens(text)))
        contact = contains(text, "contact")
        if route == 0 and topic_hits == 0 and not contact:
            continue
        seen.add(normalized.normalized)
        ranked.append(
            (
                route * 10 + min(topic_hits, 3) + int(contact),
                normalized.normalized,
                {
                    "original_url": url,
                    "normalized_url": normalized.normalized,
                    "host": normalized.host,
                    "domain": normalized.registered_domain,
                },
            )
        )
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in ranked[:2]]
