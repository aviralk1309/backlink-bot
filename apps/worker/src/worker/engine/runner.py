"""M3-S7 job runner: pick up queued jobs, complete drained jobs.

Stateless. The state lives in Postgres (see 20261014*_m3_job_runner.sql), so
every worker runs this loop and a crashed worker strands nothing. Pause and
stop need no code here: the SQL functions only touch `queued` and `running`
jobs.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import psycopg
import structlog
from psycopg_pool import AsyncConnectionPool

from worker.engine import gap, queries


@dataclass(frozen=True, slots=True)
class TickResult:
    picked_up: int
    failed: int
    completed: int


async def pick_up_next_job(pool: AsyncConnectionPool) -> tuple[uuid.UUID, str] | None:
    """Publish pickup and all imports together; a disconnect rolls back both.

    The SQL pickup holds the job lock until this transaction commits. Other
    runners see Queued and SKIP LOCKED; completion/check claims see no Running
    job until gap and seed rows, sources and counters are durable.
    """
    import_result: gap.GapAndSeedImportResult | None = None
    query_plan: queries.QueryPlan | None = None
    log = structlog.get_logger()
    async with pool.connection() as conn, conn.transaction():
        cur = await conn.execute("select job_id, outcome from public.worker_pick_up_next_job()")
        row = await cur.fetchone()
        if row is None:
            return None
        job_id, outcome = row
        if outcome == "running":
            try:
                # Savepoint: an unrecoverable import error removes *all* partial
                # imports but keeps the pickup lock, allowing an atomic failure
                # transition without another runner taking over this job.
                async with conn.transaction():
                    import_result = await gap.import_job_gap_and_seeds(conn, job_id)
                    query_plan = await queries.create_job_queries(conn, job_id)
            except (psycopg.OperationalError, psycopg.InterfaceError):
                # Connection loss, deadlocks, serialization conflicts and query
                # cancellation roll back pickup too. Retry on the next poll.
                raise
            except Exception as exc:
                log.exception("job_import_failed", job_id=str(job_id))
                reason = (
                    f"query_plan_failed:{exc}"
                    if isinstance(exc, queries.QueryPlanError)
                    else f"import_failed:{type(exc).__name__}"
                )
                await conn.execute(
                    "select public.worker_transition_job(%s, 'fail', %s)",
                    (job_id, reason),
                )
                outcome = "failed"
    # Report success only after the commit (which may itself fail).
    if outcome == "running" and import_result is not None:
        log.info(
            "job_import_completed",
            job_id=str(job_id),
            gap_created=import_result.gap_opportunities_created,
            gap_dupes=import_result.gap_duplicates_skipped,
            seed_created=import_result.seed_opportunities_created,
            seed_dupes=import_result.seed_duplicates_skipped,
            queries_created=len(query_plan.rows) if query_plan else 0,
        )
        if query_plan and query_plan.capped:
            log.warning(
                "query_plan_capped",
                job_id=str(job_id),
                generated=len(query_plan.rows),
                potential=query_plan.potential_calls,
            )
    return job_id, outcome


async def complete_drained_jobs(pool: AsyncConnectionPool) -> list[uuid.UUID]:
    async with pool.connection() as conn:
        cur = await conn.execute("select * from public.worker_complete_drained_jobs()")
        return [r[0] for r in await cur.fetchall()]


class JobRunner:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        poll_seconds: float,
        stop: asyncio.Event,
        max_pickups_per_tick: int = 20,
    ) -> None:
        self._pool = pool
        self._poll = poll_seconds
        self._stop = stop
        self._max_pickups = max_pickups_per_tick
        self._log = structlog.get_logger()

    async def run(self) -> None:
        while not self._stop.is_set():
            try:
                await self.tick()
            except Exception:
                self._log.exception("runner_tick_failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._poll)
            except TimeoutError:
                pass

    async def tick(self) -> TickResult:
        picked = 0
        failed = 0
        for _ in range(self._max_pickups):
            result = await pick_up_next_job(self._pool)
            if result is None:
                break
            job_id, outcome = result
            if outcome == "failed":
                failed += 1
                self._log.error("job_failed_at_pick_up", job_id=str(job_id))
            else:
                picked += 1
                self._log.info("job_picked_up", job_id=str(job_id))
        completed = await complete_drained_jobs(self._pool)
        for job_id in completed:
            self._log.info("job_completed", job_id=str(job_id), reason="drained")
        return TickResult(picked, failed, len(completed))
