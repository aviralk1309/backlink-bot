"""Claim-fenced initial scoring. Queue assignment remains a separate stage."""

from typing import Any

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from worker.checks.store import LostCheckClaim
from worker.engine.claims import ClaimedRow
from worker.scoring.engine import ScoreResult


async def save_score(
    conn: AsyncConnection[Any], claim: ClaimedRow, worker_id: str, result: ScoreResult
) -> None:
    cursor = await conn.execute(
        "select public.worker_save_opportunity_score(%s,%s,%s,%s,%s,%s,%s)",
        (
            claim.id,
            worker_id,
            claim.attempts,
            claim.config_version,
            result.score,
            result.tier,
            Jsonb(result.breakdown),
        ),
    )
    row = await cursor.fetchone()
    if row is None or not row[0]:
        raise LostCheckClaim("Opportunity scoring claim expired or was superseded")


async def assign_scored_row(conn: AsyncConnection[Any], claim: ClaimedRow, worker_id: str) -> str:
    """Assign queue membership and complete the check claim atomically after scoring."""
    cursor = await conn.execute(
        "select public.worker_assign_opportunity_queue(%s,%s,%s,%s)",
        (claim.id, worker_id, claim.attempts, claim.config_version),
    )
    row = await cursor.fetchone()
    if row is None or row[0] is None:
        raise LostCheckClaim("Opportunity queue assignment claim expired or was superseded")
    return str(row[0])
