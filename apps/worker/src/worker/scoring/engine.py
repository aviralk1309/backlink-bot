"""Deterministic scoring shared by initial publication and explicit rescoring."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from worker.checks.framework import CheckResult, CheckRun
from worker.scoring.config import ScoringSnapshot

# Stable reason codes form the display catalog; text is not inferred from evidence.
REASONS = {
    "score_relevance": "Topical relevance",
    "score_language_region": "Language and region match",
    "score_activity_fit": "Activity fit",
    "score_overlap": "Found across competitor domains",
    "score_multi_query": "Found by multiple search queries",
    "score_spam_penalty": "Spam warning signals",
    "score_essential_unknown": "An essential check is missing or inconclusive",
    "score_domain_cap": "Not checked because the domain limit was reached",
}


class Opportunity(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True)
    config_version: int = Field(ge=1)
    activity_key: str | None = None
    check_reason: str | None = None
    queue_group: str | None = None


class SourceSignals(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True)
    overlap_count: int = Field(default=0, ge=0)
    query_count: int = Field(default=0, ge=0)


@dataclass(frozen=True)
class ScoreResult:
    score: Decimal
    tier: Literal["high", "medium", "low", "unchecked"]
    breakdown: dict[str, JsonValue]


def _numeric(check: CheckResult | None) -> Decimal:
    if check is None or check.status == "could_not_check":
        return Decimal(0)
    value = check.evidence.get("score")
    if type(value) not in (float, int):
        return Decimal(0)
    return max(Decimal(0), min(Decimal(1), Decimal(str(value))))


def score(
    opportunity: Opportunity,
    checks: CheckRun,
    source_signals: SourceSignals,
    config: ScoringSnapshot,
) -> ScoreResult:
    """Only inputs determine output; neither source mode nor wall clock affects score.

    Positive contributions sum to at most 100; spam subtracts up to its cap.
    Diminishing boosts use n/(n+k), with multi-query n=max(queries-1,0).
    Unknown nonessential checks contribute zero, never a fabricated pass.
    """
    if opportunity.config_version != checks.config_version:
        raise ValueError("Check version does not match opportunity")
    if opportunity.queue_group == "auto_filtered":
        raise ValueError("Auto-filtered opportunities must not be scored")
    records = {r.check_key: r.result for r in checks.records}
    if len(records) != len(checks.records):
        raise ValueError("Duplicate check keys")
    profile_key = opportunity.activity_key
    if profile_key is None and (activity := records.get("activity_fit")):
        key = activity.evidence.get("activity_key")
        profile_key = key if isinstance(key, str) else None
    profile = config.profiles.get(profile_key) if profile_key else None
    policy = config.policy
    weights = profile.weights if profile and profile.weights else policy.weights
    unknown = [
        key
        for key in ("page_loads", "language", "relevance")
        if key not in records or records[key].status == "could_not_check"
    ]
    # Malformed/missing relevance evidence must not manufacture a verified tier.
    relevance = records.get("relevance")
    if relevance and type(relevance.evidence.get("score")) not in (float, int):
        if "relevance" not in unknown:
            unknown.append("relevance")
    capped = opportunity.check_reason == "domain_cap"
    with localcontext() as ctx:
        ctx.prec = 28
        language = Decimal(int("language" in records and records["language"].status == "pass"))
        region = records.get("region")
        language_region = language
        if region is None or region.reason_code != "region_disabled":
            language_region = (language + int(region is not None and region.status == "pass")) / 2
        spam = records.get("spam_signals")
        signals = spam.evidence.get("signals", []) if spam else []
        signal_count = (
            len({s for s in signals if isinstance(s, str)}) if isinstance(signals, list) else 0
        )
        # A failed legacy check without detailed signals still carries one warning.
        if spam and spam.status == "fail":
            signal_count = max(1, signal_count)
        overlap = Decimal(source_signals.overlap_count)
        queries = Decimal(max(0, source_signals.query_count - 1))
        linkability = records.get("linkability")
        activity_fit = _numeric(records.get("activity_fit"))
        if linkability and linkability.status != "could_not_check":
            activity_fit = min(
                activity_fit,
                _numeric(linkability) if linkability.status == "pass" else Decimal(0),
            )
        raw = {
            "relevance": _numeric(relevance),
            "language_region": language_region,
            "activity_fit": activity_fit,
            "overlap": overlap / (overlap + policy.overlap_half_saturation),
            "multi_query": queries / (queries + policy.query_half_saturation),
            "spam_penalty": min(Decimal(1), Decimal(signal_count) / policy.spam_signal_cap),
        }
        components: list[JsonValue] = []
        ranked: list[tuple[Decimal, int, str]] = []
        total = Decimal(0)
        for index, (key, value) in enumerate(raw.items()):
            weight = getattr(weights, key) * (-1 if key == "spam_penalty" else 1)
            points = (value * weight).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total += points
            reason = f"score_{key}"
            components.append(
                {
                    "component": key,
                    "raw": float(value),
                    "weight": weight,
                    "points": float(points),
                    "reason_code": reason,
                }
            )
            if points:
                ranked.append((-abs(points), index, reason))
        total = max(Decimal("0.00"), min(Decimal("100.00"), total))
        tier: Literal["high", "medium", "low", "unchecked"] = "low"
        if capped or unknown:
            tier = "unchecked"
        elif total >= Decimal(str(policy.high_threshold)):
            tier = "high"
        elif total >= Decimal(str(policy.medium_threshold)):
            tier = "medium"
        reasons = (
            (["score_domain_cap"] if capped else [])
            + (["score_essential_unknown"] if unknown else [])
            + [r for _, _, r in sorted(ranked)]
        )
        breakdown: dict[str, JsonValue] = {
            "algorithm_version": 2 if linkability else 1,
            "config_version": checks.config_version,
            "scoring_config_version": policy.version,
            "activity_key": profile_key,
            "activity_profile_version": profile.version if profile else None,
            "policy": policy.model_dump(mode="json"),
            "weights": weights.model_dump(mode="json"),
            "components": components,
            "linkability": (
                {
                    "status": linkability.status,
                    "score": linkability.evidence.get("score"),
                    "activity_key": linkability.evidence.get("activity_key"),
                    "algorithm_version": linkability.evidence.get("algorithm_version"),
                }
                if linkability
                else None
            ),
            "unknown_checks": [key for key in unknown],
            "top_reasons": [{"reason_code": r, "text": REASONS[r]} for r in reasons[:3]],
        }
        return ScoreResult(total, tier, breakdown)
