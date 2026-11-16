"""Stable reason vocabulary; S4 classes select reasons, S7 assigns score weights.

Templates reference only compact structured evidence, never HTML. Codes are a
storage contract: change wording freely, but do not repurpose existing codes.
"""

from typing import TYPE_CHECKING

from worker.checks.framework import Reason

if TYPE_CHECKING:
    from worker.checks.framework import CheckRegistry

PAGE_LOAD_REASONS = {
    "page_loaded": Reason("pass", "Page loaded successfully.", 10),
    "page_not_found": Reason("fail", "Page was not found (HTTP 404).", 100),
    "page_gone": Reason("fail", "Page has been removed (HTTP 410).", 100),
    "robots_disallowed_for_bot": Reason(
        "could_not_check", "The site's robots rules disallow our crawler.", 90
    ),
    "robots_unavailable": Reason(
        "could_not_check", "Robots rules could not be retrieved safely.", 90
    ),
    "origin_blocked_cooldown": Reason(
        "could_not_check", "Checks are deferred while the site's blocking cooldown is active.", 90
    ),
    "fetch_timeout": Reason(
        "could_not_check", "The page did not respond within the time limit.", 90
    ),
    "blocked_suspected": Reason(
        "could_not_check", "The site appears to block automated requests.", 90
    ),
    "js_only_suspected": Reason(
        "could_not_check", "The page appears to require JavaScript to show its content.", 80
    ),
    "tls_error": Reason("could_not_check", "A secure connection could not be established.", 90),
    "ssrf_blocked": Reason("could_not_check", "The target is blocked by network safety rules.", 90),
    "non_html": Reason("could_not_check", "The response is not an HTML page.", 80),
    "too_large": Reason("could_not_check", "The response exceeds the page size limit.", 80),
    "too_many_redirects": Reason("could_not_check", "The page exceeds the redirect limit.", 80),
}

PAGE_LOAD_REASONS.update(
    {
        "persistent_server_error": Reason(
            "fail", "The server still returned an error after retries.", 100
        ),
        "dns_failure": Reason("fail", "The page hostname could not be resolved.", 100),
        "page_unavailable": Reason("could_not_check", "A readable page could not be obtained.", 90),
    }
)

CHECK_REASONS = {
    "indexable": {
        "meta_noindex": Reason("fail", "The page declares a noindex directive.", 100),
        "header_noindex": Reason("fail", "The HTTP response declares a noindex directive.", 100),
        "googlebot_disallowed": Reason(
            "fail", "Robots rules disallow Googlebot for this URL.", 100
        ),
        "googlebot_rules_unknown": Reason(
            "could_not_check", "Googlebot crawl permissions are unknown.", 80
        ),
        "indexing_allowed": Reason("pass", "No indexing restriction was found.", 10),
    },
    "language": {
        "language_mixed": Reason(
            "could_not_check", "The page contains substantial text in multiple languages.", 80
        ),
        "language_not_configured": Reason(
            "could_not_check", "No target language is configured.", 80
        ),
        "language_unsupported": Reason(
            "could_not_check", "The target language is not supported by the detector.", 80
        ),
        "language_insufficient_text": Reason(
            "could_not_check", "Too little visible text to determine language.", 80
        ),
        "language_uncertain": Reason("could_not_check", "Language detection is inconclusive.", 80),
        "language_conflicting": Reason(
            "could_not_check", "Declared and detected language evidence conflicts.", 80
        ),
        "language_matches": Reason("pass", "The page matches the target language.", 30),
        "language_mismatch": Reason(
            "fail", "The page is confidently in a different language.", 100
        ),
    },
    "region": {
        "region_disabled": Reason("pass", "Region filtering is disabled.", 0),
        "region_not_configured": Reason("could_not_check", "No target region is configured.", 60),
        "region_conflicting": Reason(
            "could_not_check", "The page has conflicting regional signals.", 60
        ),
        "region_unknown": Reason(
            "could_not_check", "There is insufficient evidence of the page's region.", 60
        ),
        "region_matches": Reason("pass", "Regional signals match the target.", 20),
        "region_mismatch": Reason(
            "fail", "Regional signals consistently indicate a different country.", 60
        ),
    },
    "relevance": {
        "relevance_no_terms": Reason("could_not_check", "No relevance terms are configured.", 80),
        "relevance_no_text": Reason(
            "could_not_check", "No text is available for relevance matching.", 80
        ),
        "relevance_matches": Reason(
            "pass", "The page matches {matched_count} configured relevance terms.", 50
        ),
        "relevance_low": Reason("fail", "The page has weak relevance to the configured terms.", 70),
    },
    "spam_signals": {
        "spam_no_signals": Reason("pass", "No configured spam warning was found.", 10),
        "spam_outbound_count": Reason("fail", "The page has unusually many outbound links.", 70),
        "spam_outbound_ratio": Reason("fail", "Most links on the page point to other sites.", 70),
        "spam_thin_content": Reason("fail", "The page contains little visible text.", 70),
        "spam_keywords": Reason("fail", "The page contains configured spam-related phrases.", 70),
        "spam_missing_contact_about": Reason(
            "fail", "Cached domain observations found neither contact nor about pages.", 70
        ),
        "spam_suspicious_tld": Reason(
            "fail", "The site's suffix is on the configured caution list.", 70
        ),
    },
    "activity_fit": {
        "activity_profiles_missing": Reason(
            "could_not_check", "No enabled profile is available for the selected activities.", 70
        ),
        "activity_matches": Reason("pass", "The page fits the {activity_key} activity.", 50),
        "activity_no_match": Reason(
            "fail", "The page does not match the configured activity signals.", 60
        ),
    },
    "linkability": {
        "linkability_profiles_missing": Reason(
            "could_not_check", "No supported placement profile is configured.", 30
        ),
        "linkability_route_found": Reason(
            "pass", "The page shows an editorial placement route for {activity_key}.", 60
        ),
        "linkability_no_route": Reason(
            "fail", "No supported editorial placement route is visible on this page.", 60
        ),
    },
    "banned_category": {
        "banned_category_match": Reason(
            "fail", "The page matches a category excluded by this job.", 100
        ),
        "banned_categories_clear": Reason("pass", "No configured banned category was found.", 0),
    },
}


def default_registry() -> "CheckRegistry":
    from worker.checks.content import ActivityFit, BannedCategory, Linkability, Region, SpamSignals
    from worker.checks.core import Indexable, PageLoads
    from worker.checks.framework import Check, CheckDefinition, CheckRegistry
    from worker.checks.text import LanguageCheck, Relevance

    checks: list[tuple[str, Check]] = [
        ("indexable", Indexable()),
        ("language", LanguageCheck()),
        ("region", Region()),
        ("relevance", Relevance()),
        ("spam_signals", SpamSignals()),
        ("activity_fit", ActivityFit()),
        ("linkability", Linkability()),
        ("banned_category", BannedCategory()),
    ]
    return CheckRegistry(
        [
            CheckDefinition(
                "page_loads",
                PageLoads(),
                0,
                PAGE_LOAD_REASONS,
                frozenset({"fail", "could_not_check"}),
            ),
            *[
                CheckDefinition(key, check, order, CHECK_REASONS[key])
                for order, (key, check) in enumerate(checks, start=1)
            ],
        ]
    )
