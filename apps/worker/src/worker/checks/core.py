"""Page availability and indexability checks over captured HTTP/robots evidence."""

import re

from protego import Protego
from pydantic import JsonValue

from worker.checks.framework import CheckContext, CheckResult
from worker.fetch.types import FetchOutcome


class PageLoads:
    async def run(self, context: CheckContext) -> CheckResult:
        fetch = context.fetch
        evidence: dict[str, JsonValue] = {
            "fetch_outcome": fetch.outcome,
            "http_status": fetch.status_code,
        }
        if fetch.outcome == "ok" and fetch.text and 200 <= (fetch.status_code or 200) < 300:
            return CheckResult("pass", "page_loaded", evidence=evidence)
        if fetch.outcome == "http_4xx" and fetch.status_code in (404, 410):
            return CheckResult(
                "fail",
                "page_not_found" if fetch.status_code == 404 else "page_gone",
                evidence=evidence,
            )
        if fetch.outcome == "http_5xx" and fetch.status_code and fetch.status_code >= 500:
            return CheckResult("fail", "persistent_server_error", evidence=evidence)
        if fetch.outcome == "dns_fail":
            return CheckResult("fail", "dns_failure", evidence=evidence)
        codes: dict[FetchOutcome, str] = {
            "timeout": "fetch_timeout",
            "tls_error": "tls_error",
            "blocked_suspected": "blocked_suspected",
            "js_only_suspected": "js_only_suspected",
            "non_html": "non_html",
            "too_large": "too_large",
            "ssrf_blocked": "ssrf_blocked",
            "too_many_redirects": "too_many_redirects",
        }
        code = codes.get(fetch.outcome, "page_unavailable")
        if fetch.outcome == "could_not_check" and fetch.reason_code in (
            "robots_disallowed_for_bot",
            "robots_unavailable",
            "origin_blocked_cooldown",
        ):
            code = fetch.reason_code
        return CheckResult("could_not_check", code, evidence=evidence)


def has_noindex_directive(value: str) -> bool:
    # Keep directive values attached: max-image-preview:none is not noindex.
    directives = re.findall(r"[a-z][a-z_-]*(?:\s*:\s*[^\s,]+)?", value.lower())
    return any(directive in ("noindex", "none") for directive in directives)


def header_noindex(value: str) -> bool:
    """A named bot scope lasts until the next scope in a combined HTTP header."""
    scope = ""
    for segment in value.lower().split(","):
        match = re.match(r"\s*([\w*-]+)\s*:\s*(.*)", segment)
        if match:
            prefix, rest = match.groups()
            if prefix not in (
                "max-snippet",
                "max-video-preview",
                "max-image-preview",
                "unavailable_after",
            ):
                scope, segment = prefix, rest
        if scope in ("", "googlebot", "*") and has_noindex_directive(segment):
            return True
    return False


class Indexable:
    async def run(self, context: CheckContext) -> CheckResult:
        page = context.page
        evidence: dict[str, JsonValue] = {
            "canonical_url": page.canonical,
            "canonical_differs": bool(page.canonical and page.canonical != context.fetch.final_url),
        }
        if any(has_noindex_directive(value) for value in page.robots):
            return CheckResult("fail", "meta_noindex", evidence=evidence)
        headers = {key.lower(): value for key, value in context.fetch.headers.items()}
        values = context.fetch.x_robots_tags or [headers.get("x-robots-tag", "")]
        if any(header_noindex(value) for value in values):
            return CheckResult("fail", "header_noindex", evidence=evidence)
        if context.robots_txt is None:
            return CheckResult("could_not_check", "googlebot_rules_unknown", evidence=evidence)
        if not Protego.parse(context.robots_txt).can_fetch(context.fetch.final_url, "Googlebot"):
            return CheckResult("fail", "googlebot_disallowed", evidence=evidence)
        return CheckResult("pass", "indexing_allowed", evidence=evidence)
