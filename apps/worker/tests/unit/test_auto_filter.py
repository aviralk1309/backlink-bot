import pytest

from worker.checks.auto_filter import select_auto_filter
from worker.checks.framework import CheckRecord, CheckResult, CheckRun
from worker.checks.inputs import CheckSettings

pytestmark = pytest.mark.unit
CLEAR = [
    ("page_loads", "page_not_found"),
    ("page_loads", "page_gone"),
    ("page_loads", "persistent_server_error"),
    ("page_loads", "dns_failure"),
    ("indexable", "meta_noindex"),
    ("indexable", "header_noindex"),
    ("indexable", "googlebot_disallowed"),
    ("language", "language_mismatch"),
    ("banned_category", "banned_category_match"),
]
LANGUAGE = {
    "confidence": 0.99,
    "margin": 0.8,
    "target": "en",
    "detected": "fr",
    "letters": 300,
    "declared": ["fr"],
}


def run(key, reason, status="fail", evidence=None):
    return CheckRun(1, (CheckRecord(key, CheckResult(status, reason, evidence=evidence or {})),))


@pytest.mark.parametrize("key,reason", CLEAR)
async def test_each_clear_failure_has_readable_reason(key, reason):
    decision = select_auto_filter(run(key, reason, evidence=LANGUAGE))
    assert decision.check_key == key
    assert decision.reason_code == reason
    assert len(decision.detail) > 10
    assert "_" not in decision.detail


@pytest.mark.parametrize("key,reason", CLEAR)
@pytest.mark.parametrize("status", ["pass", "could_not_check"])
def test_reason_alone_never_filters_a_nonfailed_check(key, reason, status):
    assert select_auto_filter(run(key, reason, status, LANGUAGE)) is None


@pytest.mark.parametrize(
    "key,reason",
    [
        ("page_loads", "fetch_timeout"),
        ("page_loads", "tls_error"),
        ("page_loads", "robots_disallowed_for_bot"),
        ("page_loads", "robots_unavailable"),
        ("page_loads", "blocked_suspected"),
        ("indexable", "googlebot_rules_unknown"),
        ("language", "language_conflicting"),
        ("language", "language_mixed"),
        ("relevance", "relevance_low"),
        ("activity_fit", "activity_no_match"),
        ("region", "region_mismatch"),
        ("spam_signals", "spam_keywords"),
        ("spam_signals", "spam_suspicious_tld"),
        ("spam_signals", "spam_thin_content"),
        ("page_loads", "future_reason"),
        ("custom_check", "page_gone"),
    ],
)
def test_unlisted_reasons_continue_even_when_status_is_fail(key, reason):
    assert select_auto_filter(run(key, reason)) is None


@pytest.mark.parametrize(
    "change",
    [
        {"confidence": 0.89},
        {"margin": 0.19},
        {"confidence": True},
        {"confidence": "0.99"},
        {"margin": None},
        {"confidence": 1.1},
        {"detected": "en"},
        {"target": ""},
        {"letters": 3},
        {"declared": ["en"]},
        {"detected_segments": ["fr", "en"]},
    ],
)
def test_weak_or_inconsistent_language_evidence_continues(change):
    assert (
        select_auto_filter(run("language", "language_mismatch", evidence=LANGUAGE | change)) is None
    )


def test_thresholds_use_pinned_settings_and_cannot_weaken_high_confidence_floor():
    checks = run("language", "language_mismatch", evidence=LANGUAGE | {"confidence": 0.95})
    assert select_auto_filter(checks, CheckSettings(language_confidence=0.98)) is None
    weak = run("language", "language_mismatch", evidence=LANGUAGE | {"confidence": 0.6})
    assert select_auto_filter(weak, CheckSettings(language_confidence=0.5)) is None
    assert select_auto_filter(run("language", "language_mismatch")) is None


def test_precedence_is_stable_and_records_remain_unchanged():
    records = tuple(
        run(key, reason, evidence=LANGUAGE).records[0] for key, reason in reversed(CLEAR)
    )
    # Use one record per key, as required by the registry.
    records = tuple({record.check_key: record for record in records}.values())
    checks = CheckRun(1, records)
    assert select_auto_filter(checks).check_key == "page_loads"
    assert checks.records == records


def test_duplicate_checks_are_rejected():
    record = run("page_loads", "page_gone").records[0]
    with pytest.raises(ValueError, match="duplicate"):
        select_auto_filter(CheckRun(1, (record, record)))


@pytest.mark.parametrize(
    "case,expected",
    [
        ("noindex", "meta_noindex"),
        ("language", "language_mismatch"),
        ("banned", "banned_category_match"),
        ("unknown", None),
    ],
)
async def test_actual_s4_outputs_feed_filter_policy(case, expected):
    from pathlib import Path

    from worker.checks.catalog import default_registry
    from worker.checks.framework import CheckContext
    from worker.fetch.types import FetchResult

    fixtures = Path(__file__).parents[1] / "fixtures/checks"
    html = (
        fixtures
        / {
            "noindex": "noindex.html",
            "language": "language_fr.html",
            "banned": "spam.html",
            "unknown": "guest_post.html",
        }[case]
    ).read_text()
    fetch = FetchResult(
        "https://example.com", "https://example.com", "ok", status_code=200, text=html
    )
    if case == "unknown":
        fetch.outcome = "could_not_check"
        fetch.reason_code = "robots_disallowed_for_bot"
    context = CheckContext(
        fetch, 1, {"language": "en", "banned_categories": ["gambling"]}, robots_txt=""
    )
    checks = await default_registry().run(context)
    decision = select_auto_filter(checks, context.job.check_settings)
    assert (decision.reason_code if decision else None) == expected
