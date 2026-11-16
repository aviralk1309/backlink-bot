"""One bounded DOM extraction shared by all checks. No page body is persisted."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from selectolax.lexbor import LexborHTMLParser

from worker.fetch.types import FetchResult
from worker.urls.domain import registered_domain


def tokens(text: str) -> list[str]:
    words: list[str] = []
    current: list[str] = []
    for char in unicodedata.normalize("NFKC", text).casefold():
        if char.isalnum() or current and unicodedata.category(char).startswith("M"):
            current.append(char)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return words


def contains(text: str, phrase: str) -> bool:
    needle = " ".join(tokens(phrase))
    return bool(needle) and f" {needle} " in f" {' '.join(tokens(text))} "


def safe_url(base: str, href: str) -> str | None:
    try:
        url = urljoin(base, href.strip())
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username:
            return None
        return url if len(url) <= 4096 else None
    except ValueError:
        return None


@dataclass(frozen=True)
class Page:
    title: str
    headings: str
    primary_heading: str
    meta: str
    body: str
    html_lang: str
    robots: tuple[str, ...]
    canonical: str | None
    hreflangs: tuple[str, ...]
    link_count: int
    outbound_links: int
    outbound_list_links: int
    contact_link: bool
    about_link: bool
    internal_links: tuple[tuple[str, str], ...]

    @classmethod
    def from_fetch(cls, fetch: FetchResult) -> Page:
        tree = LexborHTMLParser((fetch.text or "")[: 2 * 1024 * 1024])
        html = tree.css_first("html")
        lang = (html.attributes.get("lang") or "").strip().lower() if html else ""
        title_node = tree.css_first("title")
        title = title_node.text(separator=" ", strip=True) if title_node else ""
        description = ""
        robots = []
        for node in tree.css("meta"):
            name = (node.attributes.get("name") or "").lower()
            content = node.attributes.get("content") or ""
            if name in ("robots", "googlebot"):
                robots.append(content.lower())
            if name == "description":
                description = content
        base_node = tree.css_first("base[href]")
        base = fetch.final_url
        if base_node:
            base = safe_url(base, base_node.attributes.get("href") or "") or base
        canonical = None
        hreflangs = []
        for node in tree.css("link"):
            rel = (node.attributes.get("rel") or "").lower().split()
            if "canonical" in rel and canonical is None:
                canonical = safe_url(base, node.attributes.get("href") or "")
            if "alternate" in rel and node.attributes.get("hreflang"):
                hreflangs.append((node.attributes["hreflang"] or "").lower())
        for selector in (
            "script",
            "style",
            "template",
            "noscript",
            "[hidden]",
            '[aria-hidden="true"]',
        ):
            for node in reversed(tree.css(selector)):
                node.decompose()
        for node in reversed(tree.css("[style]")):
            style = node.attributes.get("style") or ""
            if re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", style, re.I):
                node.decompose()
        headings = " ".join(
            node.text(separator=" ", strip=True) for node in tree.css("h1,h2,h3,h4,h5,h6")
        )
        primary_node = (
            tree.css_first("main h1") or tree.css_first("article h1") or tree.css_first("h1")
        )
        primary_heading = primary_node.text(separator=" ", strip=True) if primary_node else ""
        body = tree.body.text(separator=" ", strip=True) if tree.body else ""
        host = urlsplit(fetch.final_url).hostname or ""
        domain = registered_domain(host) or host
        count = outbound = list_links = 0
        contact = about = False
        internal_links: list[tuple[str, str]] = []
        for node in tree.css("a[href]"):
            href = node.attributes.get("href") or ""
            if not href.strip() or href.startswith("#"):
                continue
            resolved = safe_url(base, href)
            if not resolved:
                continue
            count += 1
            target_host = urlsplit(resolved).hostname or ""
            external = (registered_domain(target_host) or target_host) != domain
            if external:
                outbound += 1
                parent = node.parent
                in_list = False
                excluded = False
                while parent is not None:
                    if parent.tag in ("nav", "header", "footer", "aside"):
                        excluded = True
                        break
                    if parent.tag in ("ul", "ol", "dl"):
                        in_list = True
                    parent = parent.parent
                if in_list and not excluded:
                    list_links += 1
            else:
                label = node.text(separator=" ", strip=True) + " " + urlsplit(resolved).path
                if len(internal_links) < 256:
                    internal_links.append((resolved, label[:160]))
                contact |= any(
                    contains(label, p) for p in ("contact", "contact us", "kontakt", "contactez")
                )
                about |= any(
                    contains(label, p) for p in ("about", "about us", "über uns", "a propos")
                )
        return cls(
            title,
            headings,
            primary_heading,
            description,
            body,
            lang,
            tuple(robots),
            canonical,
            tuple(hreflangs),
            count,
            outbound,
            list_links,
            contact,
            about,
            tuple(internal_links),
        )
