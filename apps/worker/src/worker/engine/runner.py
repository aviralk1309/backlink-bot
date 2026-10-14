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

import structlog
from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True, slots=True)
class TickResult:
    picked_up: int
    failed: int
    completed: int


async def pick_up_next_job(pool: AsyncConnectionPool) -> tuple[uuid.UUID, str] | None:
    """One queued job per call. Outcome is 'running' or 'failed'. None: queue empty."""
    async with pool.connection() as conn:
        cur = await conn.execute("select job_id, outcome from public.worker_pick_up_next_job()")
        row = await cur.fetchone()
    return (row[0], row[1]) if row else None


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
