import copy
import json
from dataclasses import replace
from decimal import Decimal, localcontext
from pathlib import Path

import pytest
from pydantic import ValidationError

from worker.checks.framework import CheckRecord, CheckResult, CheckRun
from worker.scoring.config import (
    DEFAULT_CONFIG,
    ProfileWeights,
    ScoringConfig,
    ScoringSnapshot,
    Weights,
)
from worker.scoring.engine import Opportunity, SourceSignals, score

pytestmark = pytest.mark.unit
GOLDEN = json.loads((Path(__file__).parents[1] / "fixtures/scoring/golden.json").read_text())
CONFIG = ScoringSnapshot(policy=DEFAULT_CONFIG)


def checks(relevance=0.8, activity=0.5, spam=(), unknown=None):
    data = {
        "page_loads": CheckResult("pass", "page_loaded"),
        "language": CheckResult("pass", "language_matches"),
        "region": CheckResult("pass", "region_disabled"),
        "relevance": CheckResult("pass", "relevance_matches", evidence={"score": relevance}),
        "activity_fit": CheckResult("pass", "activity_matches", evidence={"score": activity}),
        "spam_signals": CheckResult(
            "fail" if spam else "pass", "spam_signals", evidence={"signals": list(spam)}
        ),
    }
    if unknown:
        data[unknown] = CheckResult("could_not_check", "unknown")
    return CheckRun(1, tuple(CheckRecord(k, v) for k, v in data.items()))


@pytest.mark.parametrize("case", GOLDEN, ids=lambda c: c["name"])
def test_golden(case):
    run = checks(case["relevance"], case["activity"], case["spam"], case.get("unknown"))
    opportunity = Opportunity(
        config_version=1, check_reason="domain_cap" if case.get("cap") else None
    )
    signals = SourceSignals(overlap_count=case["overlap"], query_count=case["queries"])
    before = copy.deepcopy((run, opportunity, signals, CONFIG))
    result = score(opportunity, run, signals, CONFIG)
    assert result.score == Decimal(case["score"])
    assert result.tier == case["tier"]
    assert [c["points"] for c in result.breakdown["components"]] == case["points"]
    assert [r["reason_code"] for r in result.breakdown["top_reasons"]] == case["reasons"]
    assert result.breakdown["config_version"] == 1
    assert result.breakdown["scoring_config_version"] == 1
    assert (run, opportunity, signals, CONFIG) == before
    with localcontext() as context:
        context.prec = 4
        assert (
            score(opportunity, replace(run, records=tuple(reversed(run.records))), signals, CONFIG)
            == result
        )
    for mode in ("gap", "search"):
        op = Opportunity.model_validate(
            {"config_version": 1, "mode": mode, "check_reason": opportunity.check_reason}
        )
        assert score(op, run, signals, CONFIG) == result


@pytest.mark.parametrize("missing", ["page_loads", "language", "relevance"])
def test_missing_essential_is_unchecked(missing):
    run = checks()
    run = replace(run, records=tuple(r for r in run.records if r.check_key != missing))
    assert score(Opportunity(config_version=1), run, SourceSignals(), CONFIG).tier == "unchecked"


def test_boosts_diminish_and_spam_deduplicates():
    op = Opportunity(config_version=1)
    values = [
        score(op, checks(), SourceSignals(overlap_count=n, query_count=n + 1), CONFIG).score
        for n in range(6)
    ]
    gains = [b - a for a, b in zip(values, values[1:], strict=False)]
    assert all(g > 0 for g in gains)
    assert gains == sorted(gains, reverse=True)
    assert score(op, checks(spam=["thin", "thin"]), SourceSignals(), CONFIG) == score(
        op, checks(spam=["thin"]), SourceSignals(), CONFIG
    )


def test_placement_evidence_caps_activity_points_without_changing_legacy_rows():
    base = checks(activity=1)
    op = Opportunity(config_version=1)
    legacy = score(op, base, SourceSignals(), CONFIG)
    rejected_route = replace(
        base,
        records=base.records
        + (
            CheckRecord(
                "linkability",
                CheckResult("fail", "linkability_no_route", evidence={"score": 0.6}),
            ),
        ),
    )
    no_route = score(op, rejected_route, SourceSignals(), CONFIG)
    assert no_route.score == legacy.score - 20
    assert no_route.breakdown["algorithm_version"] == 2
    assert no_route.breakdown["linkability"]["status"] == "fail"
    assert legacy.breakdown["algorithm_version"] == 1


def test_profile_weights_and_threshold_boundaries():
    weights = Weights(
        relevance=50,
        language_region=10,
        activity_fit=20,
        overlap=10,
        multi_query=10,
        spam_penalty=30,
    )
    config = ScoringSnapshot(
        policy=DEFAULT_CONFIG, profiles={"guest_post": ProfileWeights(version=7, weights=weights)}
    )
    op = Opportunity(config_version=1, activity_key="guest_post")
    result = score(op, checks(1, 0.5), SourceSignals(), config)
    assert result.score == 70 and result.tier == "high"
    assert result.breakdown["activity_profile_version"] == 7
    assert score(op, checks(0.4, 0.5), SourceSignals(), config).tier == "medium"
    assert score(op, checks(0.39, 0.5), SourceSignals(), config).tier == "low"
    custom = ScoringConfig.model_validate(
        DEFAULT_CONFIG.model_dump() | {"high_threshold": 90, "medium_threshold": 80, "version": 2}
    )
    assert score(op, checks(1, 1), SourceSignals(), ScoringSnapshot(policy=custom)).tier == "low"


def test_invalid_config_versions_duplicates_and_filtered():
    with pytest.raises(ValueError):
        score(Opportunity(config_version=2), checks(), SourceSignals(), CONFIG)
    with pytest.raises(ValueError):
        score(
            Opportunity(config_version=1, queue_group="auto_filtered"),
            checks(),
            SourceSignals(),
            CONFIG,
        )
    run = checks()
    with pytest.raises(ValueError):
        score(
            Opportunity(config_version=1),
            replace(run, records=run.records + run.records),
            SourceSignals(),
            CONFIG,
        )
    for changes in (
        {"high_threshold": float("nan")},
        {"medium_threshold": 80},
        {"query_half_saturation": 0},
    ):
        with pytest.raises(ValidationError):
            ScoringConfig.model_validate(DEFAULT_CONFIG.model_dump() | changes)
    with pytest.raises(ValidationError):
        Weights.model_validate(DEFAULT_CONFIG.weights.model_dump() | {"relevance": 34})
    with pytest.raises(ValidationError):
        SourceSignals(query_count=-1)


def test_legacy_snapshot_fallback_is_explicit_and_pinned():
    from worker.scoring.config import from_job_snapshot

    assert from_job_snapshot({}) == CONFIG
    custom = DEFAULT_CONFIG.model_dump() | {"version": 2, "high_threshold": 90}
    assert from_job_snapshot({"scoring": {"policy": custom}}).policy.version == 2
    with pytest.raises(ValidationError):
        from_job_snapshot({"scoring": None})


def test_empty_capped_row_and_upper_bound():
    result = score(
        Opportunity(config_version=1, check_reason="domain_cap"),
        CheckRun(1, ()),
        SourceSignals(overlap_count=2),
        CONFIG,
    )
    assert result.tier == "unchecked" and result.score == 10
    assert result.breakdown["top_reasons"][0]["reason_code"] == "score_domain_cap"
    maximum = score(
        Opportunity(config_version=1),
        checks(2, 2),
        SourceSignals(overlap_count=10**8, query_count=10**8),
        CONFIG,
    )
    assert maximum.score == 100


def test_inferred_activity_and_missing_profile_weights_use_defaults():
    run = checks()
    run = replace(
        run,
        records=tuple(
            CheckRecord(
                r.check_key,
                replace(r.result, evidence={"score": 0.5, "activity_key": "guest_post"}),
            )
            if r.check_key == "activity_fit"
            else r
            for r in run.records
        ),
    )
    config = ScoringSnapshot(
        policy=DEFAULT_CONFIG, profiles={"guest_post": ProfileWeights(version=4)}
    )
    result = score(Opportunity(config_version=1), run, SourceSignals(), config)
    assert result.breakdown["activity_profile_version"] == 4
    assert result.breakdown["weights"] == DEFAULT_CONFIG.weights.model_dump()


def test_enabled_region_mismatch_gets_no_region_credit():
    run = checks()
    run = replace(
        run,
        records=tuple(
            CheckRecord("region", CheckResult("fail", "region_mismatch"))
            if r.check_key == "region"
            else r
            for r in run.records
        ),
    )
    result = score(Opportunity(config_version=1), run, SourceSignals(), CONFIG)
    assert result.breakdown["components"][1]["points"] == 5
    assert result.tier == "medium"
