"""S6: explicit quality exclusions. Unlisted or uncertain outcomes continue."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import tuple_row

from worker.checks.catalog import CHECK_REASONS, PAGE_LOAD_REASONS
from worker.checks.framework import CheckResult, CheckRun
from worker.checks.inputs import CheckSettings
from worker.checks.store import LostCheckClaim, check_run_payload
from worker.engine.claims import ClaimedRow

# First matching rule wins, independent of check execution order. All raw checks
# remain stored so secondary reasons can still be inspected.
_RULES = (
    (
        "page_loads",
        frozenset({"page_not_found", "page_gone", "persistent_server_error", "dns_failure"}),
    ),
    ("indexable", frozenset({"meta_noindex", "header_noindex", "googlebot_disallowed"})),
    ("language", frozenset({"language_mismatch"})),
    ("banned_category", frozenset({"banned_category_match"})),
)


@dataclass(frozen=True)
class FilterDecision:
    check_key: str
    reason_code: str
    detail: str


def _confident_language(result: CheckResult, settings: CheckSettings) -> bool:
    evidence = result.evidence
    confidence, margin = evidence.get("confidence"), evidence.get("margin")
    if any(type(value) not in (int, float) for value in (confidence, margin)):
        return False
    assert isinstance(confidence, (int, float)) and isinstance(margin, (int, float))
    if not math.isfinite(confidence) or not math.isfinite(margin):
        return False
    if not max(0.9, settings.language_confidence) <= confidence <= 1:
        return False
    if not max(0.2, settings.language_margin) <= margin <= 1:
        return False
    letters = evidence.get("letters")
    if type(letters) is not int or letters < settings.language_min_letters:
        return False
    target, detected = evidence.get("target"), evidence.get("detected")
    if not isinstance(target, str) or not isinstance(detected, str) or not target or not detected:
        return False
    if target == detected or target == "nb" and detected == "nn":
        return False
    segments = evidence.get("detected_segments", [])
    if not isinstance(segments, list) or any(value != detected for value in segments):
        return False
    declared = evidence.get("declared", [])
    if not isinstance(declared, list) or any(value != detected for value in declared):
        return False
    return True


def select_auto_filter(
    run: CheckRun, settings: CheckSettings | None = None
) -> FilterDecision | None:
    """None means continue; it never means pass, Ready, or a particular score."""
    by_key = {record.check_key: record.result for record in run.records}
    if len(by_key) != len(run.records):
        raise ValueError("A check run cannot contain duplicate check keys")
    for key, codes in _RULES:
        result = by_key.get(key)
        if result is None or result.status != "fail" or result.reason_code not in codes:
            continue
        if key == "language" and not _confident_language(result, settings or CheckSettings()):
            continue
        catalog = PAGE_LOAD_REASONS if key == "page_loads" else CHECK_REASONS[key]
        return FilterDecision(
            key, result.reason_code, catalog[result.reason_code].render(result.evidence)
        )
    return None


async def publish_checks_and_filter(
    conn: AsyncConnection[Any],
    claim: ClaimedRow,
    worker_id: str,
    run: CheckRun,
    settings: CheckSettings | None = None,
) -> FilterDecision | None:
    """Save raw checks plus any exclusion atomically in the caller's transaction.

    Filtered rows finish now. For None, the claim remains running for S7/S8/S9.
    Pass thresholds from the pinned job config, not live mutable job settings.
    """
    if run.config_version != claim.config_version:
        raise ValueError("Run configuration does not match the claimed opportunity")
    decision = select_auto_filter(run, settings)
    async with conn.cursor(row_factory=tuple_row) as cursor:
        await cursor.execute(
            "select public.worker_publish_check_filter(%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                claim.id,
                worker_id,
                claim.attempts,
                run.config_version,
                check_run_payload(run),
                decision.check_key if decision else None,
                decision.reason_code if decision else None,
                decision.detail if decision else None,
            ),
        )
        row = await cursor.fetchone()
    if row is None or not row[0]:
        raise LostCheckClaim("Opportunity check claim expired or was superseded")
    return decision
