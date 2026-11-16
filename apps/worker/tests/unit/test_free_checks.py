import json
from pathlib import Path

import pytest

from worker.checks.catalog import default_registry
from worker.checks.content import ActivityFit, BannedCategory, Linkability, Region, SpamSignals
from worker.checks.core import Indexable, PageLoads, header_noindex
from worker.checks.framework import CheckContext
from worker.checks.inputs import ActivityProfile
from worker.checks.text import LanguageCheck, Relevance
from worker.fetch.domain_cache import DomainFacts
from worker.fetch.types import FetchResult

pytestmark = pytest.mark.unit
FIXTURES = Path(__file__).parents[1] / "fixtures/checks"
LANGUAGES = json.loads((FIXTURES / "languages.json").read_text())


def profiles():
    return (
        ActivityProfile(
            key="guest_post",
            page_type_signals={
                "url_patterns": ["write-for-us", "contribute"],
                "title_phrases": ["write for us"],
                "heading_phrases": ["guest post guidelines"],
                "body_phrases": ["contributors"],
            },
        ),
        ActivityProfile(
            key="resource_page",
            page_type_signals={
                "title_phrases": ["resources"],
                "heading_phrases": ["further reading"],
                "structure": {"link_list": True, "min_outbound_links": 10},
            },
        ),
    )


def context(html="<html><body>Example text</body></html>", config=None, **kwargs):
    fetch = kwargs.pop(
        "fetch",
        FetchResult(
            url="https://example.com/page",
            final_url="https://example.com/page",
            outcome="ok",
            status_code=200,
            text=html,
            headers={"content-type": "text/html"},
        ),
    )
    return CheckContext(fetch, 1, config or {}, **kwargs)


@pytest.mark.parametrize(
    "case", json.loads((FIXTURES / "manifest.json").read_text()), ids=lambda c: c["file"]
)
async def test_labelled_fixtures(case):
    ctx = context(
        (FIXTURES / case["file"]).read_text(),
        {
            "language": case.get("target", "en"),
            "activity_keys": ["guest_post", "resource_page"],
            "banned_categories": ["gambling"],
            "seed_keywords": ["gardening"],
        },
        robots_txt="",
        activity_profiles=profiles(),
    )
    run = await default_registry().run(ctx)
    result = next(r.result for r in run.records if r.check_key == case["check"])
    assert result.status == case["status"]
    assert result.reason_code == case["reason"]
    assert len(default_registry().top_reasons(run)) == 3


@pytest.mark.parametrize(
    "outcome,status,expected",
    [
        ("ok", 200, "pass"),
        ("http_4xx", 404, "fail"),
        ("http_4xx", 410, "fail"),
        ("http_5xx", 503, "fail"),
        ("dns_fail", None, "fail"),
        ("http_4xx", 403, "could_not_check"),
        ("http_4xx", 401, "could_not_check"),
        ("timeout", None, "could_not_check"),
        ("tls_error", None, "could_not_check"),
        ("blocked_suspected", 503, "could_not_check"),
        ("js_only_suspected", 200, "could_not_check"),
        ("non_html", 200, "could_not_check"),
        ("too_large", 200, "could_not_check"),
        ("ssrf_blocked", None, "could_not_check"),
        ("too_many_redirects", 302, "could_not_check"),
        ("could_not_check", None, "could_not_check"),
        ("http_5xx", None, "could_not_check"),
    ],
)
async def test_fetch_outcome_matrix(outcome, status, expected):
    ctx = context(
        fetch=FetchResult(
            "https://example.com",
            "https://example.com",
            outcome,
            status_code=status,
            text="<html>Text</html>",
        )
    )
    run = await default_registry().run(ctx)
    assert run.records[0].result.status == expected
    assert len(run.records) == (9 if expected == "pass" else 1)


@pytest.mark.parametrize(
    "reason", ["robots_disallowed_for_bot", "robots_unavailable", "origin_blocked_cooldown"]
)
async def test_preserves_robots_reason(reason):
    ctx = context(
        fetch=FetchResult(
            "https://example.com", "https://example.com", "could_not_check", reason_code=reason
        )
    )
    assert (await PageLoads().run(ctx)).reason_code == reason


@pytest.mark.parametrize(
    "value,blocked",
    [
        ("noindex", True),
        ("NOINDEX, nofollow", True),
        ("googlebot: noindex", True),
        ("otherbot: noindex, nofollow", False),
        ("max-snippet: 0, noindex", True),
        ("googlebot: max-snippet: 0, noindex", True),
        ("none", True),
        ("otherbot: noindex, googlebot: index", False),
        ("not-noindex", False),
    ],
)
def test_scoped_header_directives(value, blocked):
    assert header_noindex(value) is blocked


async def test_repeated_headers_have_independent_scopes():
    ctx = context(robots_txt="")
    ctx.fetch.x_robots_tags = ["otherbot: noindex", "noindex"]
    assert (await Indexable().run(ctx)).reason_code == "header_noindex"


@pytest.mark.parametrize(
    "meta,expected",
    [
        ('<meta name="googlebot" content="none">', "fail"),
        ('<meta name="bingbot" content="noindex">', "pass"),
        ('<meta name="robots" content="index"><meta name="robots" content="noindex">', "fail"),
    ],
)
async def test_meta_scopes_and_restrictive_rule(meta, expected):
    ctx = context(f"<html><head>{meta}</head><body>Text</body></html>", robots_txt="")
    assert (await Indexable().run(ctx)).status == expected


async def test_googlebot_separate_from_our_bot_and_unknown():
    html = '<html><head><link rel="canonical" href="../preferred"></head><body>Text</body></html>'
    ctx = context(html, robots_txt="User-agent: Googlebot\nDisallow: /page")
    result = await Indexable().run(ctx)
    assert result.reason_code == "googlebot_disallowed"
    assert result.evidence["canonical_url"] == "https://example.com/preferred"
    assert (await Indexable().run(context(html))).status == "could_not_check"
    allowed = context(html, robots_txt="User-agent: BacklinkBot\nDisallow: /")
    assert (await Indexable().run(allowed)).status == "pass"


async def test_page_extraction_drops_hidden_content_and_counts_domains():
    ctx = context((FIXTURES / "hidden.html").read_text())
    assert "casino" not in ctx.page.body
    assert ctx.page.outbound_links == 1  # example.com.evil.com is not example.com
    assert ctx.page.link_count == 2
    assert ctx.page.about_link
    assert ctx.page is ctx.page


@pytest.mark.parametrize(
    "target,declared,expected",
    [
        ("fr", "en", "language_mismatch"),
        ("en", "fr", "language_conflicting"),
        ("en", "", "language_matches"),
        ("kn", "kn", "language_unsupported"),
    ],
)
async def test_language_policy(target, declared, expected):
    ctx = context(
        f'<html lang="{declared}"><body>{LANGUAGES[0]["text"]}</body></html>', {"language": target}
    )
    assert (await LanguageCheck().run(ctx)).reason_code == expected


async def test_language_minimum_and_header_conflict():
    ctx = context('<html lang="en"><body>Hello</body></html>', {"language": "en"})
    assert (await LanguageCheck().run(ctx)).reason_code == "language_insufficient_text"
    ctx = context((FIXTURES / "language_en.html").read_text(), {"language": "en"})
    ctx.fetch.headers["Content-Language"] = "fr"
    assert (await LanguageCheck().run(ctx)).reason_code == "language_conflicting"


@pytest.mark.parametrize(
    "url,lang,enabled,expected",
    [
        ("https://example.co.uk", "en-GB", True, "region_matches"),
        ("https://example.fr", "fr-FR", True, "region_mismatch"),
        ("https://example.fr", "en-GB", True, "region_conflicting"),
        ("https://example.com", "en", True, "region_unknown"),
        ("https://example.io", "en", True, "region_unknown"),
        ("https://example.fr", "fr-FR", False, "region_disabled"),
    ],
)
async def test_region_evidence(url, lang, enabled, expected):
    ctx = context(
        f'<html lang="{lang}"><body>Text</body></html>',
        {"country": "GB", "require_language_region_match": enabled},
    )
    ctx.fetch.final_url = url
    assert (await Region().run(ctx)).reason_code == expected


async def test_region_text_and_alternates_do_not_assign_wrong_page():
    html = (
        '<html><head><link rel="alternate" hreflang="en-GB" href="/uk"></head>'
        "<body>Local events in London</body></html>"
    )
    ctx = context(html, {"country": "GB", "require_language_region_match": True})
    assert (await Region().run(ctx)).reason_code == "region_unknown"
    ctx = context(html, {"regions": ["London"], "require_language_region_match": True})
    assert (await Region().run(ctx)).reason_code == "region_matches"


async def test_relevance_weights_stemming_and_word_boundaries():
    config = {"seed_keywords": ["garden"], "language": "en"}
    title = await Relevance().run(
        context("<html><head><title>Gardening</title></head><body>Other</body></html>", config)
    )
    body = await Relevance().run(context("<html><body>Gardening</body></html>", config))
    assert title.evidence["score"] > body.evidence["score"]
    assert title.evidence["matched_terms"] == ["garden"]
    boundary = await Relevance().run(
        context("<html><body>Discard cartography</body></html>", {"seed_keywords": ["art"]})
    )
    assert boundary.evidence["score"] == 0
    assert (await Relevance().run(context())).reason_code == "relevance_no_terms"


async def test_relevance_profile_weights_and_supported_fallback():
    profile = ActivityProfile(
        key="custom",
        relevance_rule={
            "field_weights": {"title": 1, "headings": 0, "meta": 0, "body": 0},
            "min_score": 0.9,
        },
    )
    ctx = context(
        "<html><head><title>Garden</title></head><body>Text</body></html>",
        {"seed_keywords": ["garden"], "activity_keys": ["custom"], "language": "zz"},
        activity_profiles=(profile,),
    )
    result = await Relevance().run(ctx)
    assert result.status == "pass"
    assert result.evidence["score"] == 1


async def test_relevance_uses_topic_concepts_without_diluting_across_keywords():
    config = {
        "language": "en",
        "regions": ["Pokhara"],
        "seed_keywords": ["wellness retreat Pokhara", "massage classes Nepal"],
    }
    yoga = await Relevance().run(
        context(
            "<html><head><title>Pokhara yoga retreats</title></head>"
            "<body>Yoga and meditation in the mountains.</body></html>",
            config,
        )
    )
    travel = await Relevance().run(
        context(
            "<html><head><title>Visit Pokhara</title></head>"
            "<body>Explore travel destinations around Nepal.</body></html>",
            config,
        )
    )
    assert yoga.status == "pass"
    assert yoga.evidence["algorithm_version"] == 2
    assert yoga.evidence["matched_concepts"] == ["pokhara", "retreat"]
    assert yoga.evidence["geography_matches"] == ["Pokhara"]
    assert travel.status == "fail"
    assert travel.evidence["score"] == 0


async def test_spam_signals_are_individually_explained():
    ctx = context(
        (FIXTURES / "spam.html").read_text(),
        {"check_settings": {"outbound_link_limit": 10}},
        domain_facts=DomainFacts({}, False, False),
    )
    ctx.fetch.final_url = "https://example.xyz/page"
    result = await SpamSignals().run(ctx)
    assert set(result.evidence["signals"]) == {
        "spam_outbound_count",
        "spam_outbound_ratio",
        "spam_thin_content",
        "spam_keywords",
        "spam_missing_contact_about",
        "spam_suspicious_tld",
    }
    unknown = await SpamSignals().run(context((FIXTURES / "guest_post.html").read_text()))
    assert "spam_missing_contact_about" not in unknown.evidence["signals"]
    assert unknown.status == "pass"


async def test_activity_link_structure_and_deterministic_ties():
    ctx = context(
        (FIXTURES / "resources.html").read_text(),
        {"activity_keys": ["resource_page", "guest_post"]},
        activity_profiles=profiles(),
    )
    assert (await ActivityFit().run(ctx)).evidence["activity_key"] == "resource_page"
    identical = [
        ActivityProfile(key=key, page_type_signals={"body_phrases": ["text"]}) for key in ("z", "a")
    ]
    ctx = context(config={"activity_keys": ["a", "z"]}, activity_profiles=tuple(identical))
    assert (await ActivityFit().run(ctx)).evidence["activity_key"] == "a"
    assert (await ActivityFit().run(context())).status == "could_not_check"


async def test_linkability_requires_an_editorial_route_separate_from_topic():
    config = {"activity_keys": ["resource_page", "guest_post"]}
    resource = await Linkability().run(
        context((FIXTURES / "resources.html").read_text(), config, activity_profiles=profiles())
    )
    competitor = await Linkability().run(
        context(
            "<html><head><title>Yoga retreats in Nepal</title></head>"
            "<body>Book our yoga retreat in Pokhara today.</body></html>",
            config,
            activity_profiles=profiles(),
        )
    )
    guest = await Linkability().run(
        context((FIXTURES / "guest_post.html").read_text(), config, activity_profiles=profiles())
    )
    assert resource.status == "pass"
    assert resource.evidence["activity_key"] == "resource_page"
    assert competitor.reason_code == "linkability_no_route"
    assert guest.status == "pass"


async def test_resource_linkability_requires_primary_page_type_and_configured_link_count():
    config = {"activity_keys": ["resource_page"]}
    links = "".join(f'<li><a href="https://garden{i}.com">Guide</a></li>' for i in range(12))
    commercial = context(
        f"<html><head><title>Yoga retreat package</title></head><body>"
        f"<main><h1>Yoga retreat package</h1><h2>Further reading</h2><ul>{links}</ul></main>"
        "</body></html>",
        config,
        activity_profiles=profiles(),
    )
    assert (await Linkability().run(commercial)).reason_code == "linkability_no_route"
    resource = context(
        f"<html><body><main><h1>Further reading</h1><ul>{links}</ul></main></body></html>",
        config,
        activity_profiles=profiles(),
    )
    assert (await Linkability().run(resource)).status == "pass"
    assert (await Linkability().run(resource)).evidence["algorithm_version"] == 2
    short_list = "".join(f'<li><a href="https://garden{i}.com">Guide</a></li>' for i in range(9))
    too_few = context(
        f"<html><head><title>Resources</title></head><body><ul>{short_list}</ul></body></html>",
        config,
        activity_profiles=profiles(),
    )
    assert (await Linkability().run(too_few)).reason_code == "linkability_no_route"


async def test_navigation_links_do_not_count_as_editorial_lists():
    links = "".join(f'<li><a href="https://garden{i}.com">Guide</a></li>' for i in range(12))
    ctx = context(
        f"<html><head><title>Resources</title></head><body><main><h1>Resources</h1></main>"
        f"<footer><ul>{links}</ul></footer></body></html>",
        {"activity_keys": ["resource_page"]},
        activity_profiles=profiles(),
    )
    assert ctx.page.outbound_list_links == 0
    assert (await Linkability().run(ctx)).reason_code == "linkability_no_route"


async def test_banned_category_uses_job_scope_and_boundaries():
    ctx = context((FIXTURES / "spam.html").read_text(), {"banned_categories": ["gambling"]})
    assert (await BannedCategory().run(ctx)).evidence["categories"] == ["gambling"]
    assert (
        await BannedCategory().run(context((FIXTURES / "spam.html").read_text()))
    ).status == "pass"
    assert (
        await BannedCategory().run(
            context("<html><body>Pharmacy education</body></html>", {"banned_categories": ["harm"]})
        )
    ).status == "pass"


async def test_evidence_stays_small_on_large_page_and_contains_no_html():
    ctx = context(
        "<html><body>garden " + "word " * 100000 + "</body></html>",
        {"seed_keywords": ["garden"], "language": "en"},
        robots_txt="",
    )
    run = await default_registry().run(ctx)
    for record in run.records:
        encoded = json.dumps(record.result.evidence)
        assert len(encoded) < 16384
        assert "<html>" not in encoded


async def test_mixed_language_is_unknown():
    ctx = context(
        "<html><body>" + LANGUAGES[0]["text"] * 3 + LANGUAGES[1]["text"] * 3 + "</body></html>",
        {"language": "en"},
    )
    result = await LanguageCheck().run(ctx)
    assert result.status == "could_not_check"
    assert result.reason_code in ("language_mixed", "language_uncertain")


def test_combining_marks_survive_tokenization():
    from worker.checks.page import tokens

    assert tokens("बागवानी मिट्टी") == ["बागवानी", "मिट्टी"]


@pytest.mark.parametrize("best,second", [(0.6, 0.2), (0.95, 0.8)])
async def test_low_confidence_or_margin_is_unknown(monkeypatch, best, second):
    from types import SimpleNamespace

    from lingua import Language

    from worker.checks import text

    detector = SimpleNamespace(
        compute_language_confidence_values=lambda _: [
            SimpleNamespace(language=Language.ENGLISH, value=best),
            SimpleNamespace(language=Language.FRENCH, value=second),
        ]
    )
    monkeypatch.setattr(text, "language_detector", lambda: detector)
    ctx = context((FIXTURES / "language_en.html").read_text(), {"language": "fr"})
    assert (await LanguageCheck().run(ctx)).reason_code == "language_uncertain"


async def test_repeated_terms_do_not_inflate_relevance():
    config = {"seed_keywords": ["garden"], "language": "en"}
    short = await Relevance().run(context("<html><body>garden</body></html>", config))
    repeated = await Relevance().run(
        context("<html><body>" + "garden " * 200 + "</body></html>", config)
    )
    assert short.evidence["score"] == repeated.evidence["score"]


async def test_activity_url_patterns_are_literal_not_regex():
    profile = ActivityProfile(key="test", page_type_signals={"url_patterns": [".*"]})
    ctx = context(config={"activity_keys": ["test"]}, activity_profiles=(profile,))
    assert (await ActivityFit().run(ctx)).reason_code == "activity_no_match"


async def test_cjk_relevance_uses_literal_fallback():
    ctx = context(
        "<html><head><title>家庭蔬菜种植方法</title></head><body>我们分享蔬菜种植经验</body></html>",
        {"language": "zh", "seed_keywords": ["蔬菜种植"]},
    )
    assert (await Relevance().run(ctx)).status == "pass"


@pytest.mark.parametrize(
    "value,blocked",
    [
        ("max-image-preview: none", False),
        ("googlebot: max-image-preview: none", False),
        ("max-image-preview: none, noindex", True),
        ("max-image-preview:none noindex", True),
    ],
)
async def test_directive_value_none_is_not_noindex(value, blocked):
    assert header_noindex(value) is blocked
    if not value.startswith("googlebot:"):
        ctx = context(
            f'<html><head><meta name="robots" content="{value}"></head><body>Text</body></html>',
            robots_txt="",
        )
        assert (await Indexable().run(ctx)).status == ("fail" if blocked else "pass")
