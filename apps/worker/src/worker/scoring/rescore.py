"""Durable explicit rescoring: one transaction, bounded memory, no HTTP/check execution."""

import asyncio
from typing import Any
from uuid import UUID

import psycopg
import structlog
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from worker.checks.framework import CheckRecord, CheckResult, CheckRun
from worker.scoring.config import ScoringSnapshot
from worker.scoring.engine import Opportunity, SourceSignals, score


async def _apply(conn: AsyncConnection[Any], job_id: UUID, snapshot: ScoringSnapshot) -> int:
    after = UUID(int=0)
    count = 0
    while True:
        # Only terminal checked/capped rows. Filters, duplicates, pending and failed
        # work keep their existing state. Count Google provenance, not found_by_count.
        async with conn.cursor(row_factory=dict_row) as cursor:
            await cursor.execute(
                """select o.id,o.config_version,o.activity_key,o.check_reason,o.queue_group,
                  o.overlap_count,
                  (select count(*) from public.opportunity_sources s
                   where s.opportunity_id=o.id and s.source_type='google') as query_count,
                  coalesce((select jsonb_agg(jsonb_build_object(
                    'key',c.check_key,'status',c.status,'reason',c.reason_code,
                    'detail',c.detail,'evidence',c.evidence,'version',c.config_version)
                    order by c.check_key) from public.opportunity_checks c
                    where c.opportunity_id=o.id),'[]'::jsonb) as checks
                from public.opportunities o where o.job_id=%s and o.id>%s
                  and o.duplicate_of is null and o.queue_group is distinct from 'auto_filtered'
                  and (o.check_status='done'
                    or (o.check_status='skipped' and o.check_reason='domain_cap'))
                order by o.id limit 500 for update of o""",
                (job_id, after),
            )
            rows = await cursor.fetchall()
        if not rows:
            return count
        for row in rows:
            if any(c["version"] != row["config_version"] for c in row["checks"]):
                raise ValueError("Stored check version mismatch")
            checks = CheckRun(
                row["config_version"],
                tuple(
                    CheckRecord(
                        c["key"], CheckResult(c["status"], c["reason"], c["detail"], c["evidence"])
                    )
                    for c in row["checks"]
                ),
            )
            result = score(
                Opportunity.model_validate(row), checks, SourceSignals.model_validate(row), snapshot
            )
            await conn.execute(
                "update public.opportunities set score=%s,tier=%s,score_breakdown=%s where id=%s",
                (result.score, result.tier, Jsonb(result.breakdown), row["id"]),
            )
            count += 1
        after = rows[-1]["id"]


async def rescore_next(pool: AsyncConnectionPool) -> UUID | None:
    async with pool.connection() as conn, conn.transaction():
        cursor = await conn.execute(
            "select id,job_id,scoring_snapshot from public.worker_next_rescore()"
        )
        request = await cursor.fetchone()
        if request is None:
            return None
        request_id, job_id, raw_snapshot = request
        status, error, count = "done", None, 0
        try:
            # Savepoint rolls back every score on invalid stored data/configuration.
            async with conn.transaction():
                count = await _apply(conn, job_id, ScoringSnapshot.model_validate(raw_snapshot))
        except (psycopg.OperationalError, psycopg.InterfaceError):
            raise  # crash/disconnect/deadlock: retry the still-pending request
        except Exception:
            structlog.get_logger().exception("rescore_failed", request_id=str(request_id))
            status, error, count = "failed", "invalid_scoring_data", 0
        await conn.execute(
            """update public.job_rescore_requests set status=%s,scored_count=%s,
              error_code=%s,finished_at=clock_timestamp() where id=%s""",
            (status, count, error, request_id),
        )
        await conn.execute(
            "insert into public.job_events(job_id,type,payload) values(%s,%s,%s)",
            (
                job_id,
                "rescore_completed" if status == "done" else "rescore_failed",
                Jsonb({"request_id": str(request_id), "scored_count": count, "error_code": error}),
            ),
        )
    return UUID(str(request_id))


class RescoreRunner:
    def __init__(self, pool: AsyncConnectionPool, poll_seconds: float, stop: asyncio.Event):
        self.pool, self.poll_seconds, self.stop = pool, poll_seconds, stop

    async def run(self) -> None:
        while not self.stop.is_set():
            try:
                if await rescore_next(self.pool) is not None:
                    continue
            except (psycopg.OperationalError, psycopg.InterfaceError):
                structlog.get_logger().exception("rescore_retry")
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.poll_seconds)
            except TimeoutError:
                pass
