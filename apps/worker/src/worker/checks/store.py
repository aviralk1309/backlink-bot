"""Atomic, claim-fenced publication of a complete check run."""

from typing import Any

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from worker.checks.framework import CheckRun
from worker.engine.claims import ClaimedRow


class LostCheckClaim(RuntimeError):
    """Lease, attempt or pinned config no longer matches; discard these results."""


async def save_check_run(
    conn: AsyncConnection[Any], claim: ClaimedRow, worker_id: str, run: CheckRun
) -> None:
    """Use the caller's transaction so S9 can commit checks and scoring together.

    Does not complete the opportunity or touch review/queue/score state.
    A failed publication raises, rolling back the caller's transaction.
    """
    if run.config_version != claim.config_version:
        raise ValueError("Run configuration does not match the claimed opportunity")
    cursor = await conn.execute(
        "select public.worker_save_opportunity_checks(%s, %s, %s, %s, %s)",
        (claim.id, worker_id, claim.attempts, run.config_version, check_run_payload(run)),
    )
    row = await cursor.fetchone()
    if row is None or not row[0]:
        raise LostCheckClaim("Opportunity check claim expired or was superseded")


def check_run_payload(run: CheckRun) -> Jsonb:
    """Serialize the raw-check snapshot for the worker publication RPCs."""
    return Jsonb(
        [
            {
                "check_key": record.check_key,
                "status": record.result.status,
                "reason_code": record.result.reason_code,
                "detail": record.result.detail,
                "evidence": record.result.evidence,
            }
            for record in run.records
        ]
    )
