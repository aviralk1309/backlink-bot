"""M3-S6 worker loop: claim, run handlers, extend leases, reap, release on exit.

Handler contract (M5 pipeline implements it):
  * Finish a row with a guarded update:
      where id = :id and locked_by = :worker_id and check_status = 'running'
    Zero rows touched means the claim was lost: drop the result.
  * A handler that raises is logged. The row stays `running`, its lease is no
    longer extended, and the reaper retries it after the lease runs out, up to
    max_attempts. Cost: a failing row waits one lease (default 120 s) per retry.
  * Cancellation (lost lease, shutdown past the grace period) must not leave
    side effects that a retry cannot repeat.
"""

from __future__ import annotations

import asyncio
import functools
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import structlog
from psycopg_pool import AsyncConnectionPool

from worker.config.settings import Settings
from worker.engine.claims import (
    ClaimedRow,
    claim_checks,
    extend_leases,
    reap_expired,
    release_claims,
)

Handler = Callable[[ClaimedRow], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class EngineConfig:
    poll_seconds: float = 5.0
    batch_size: int = 10
    concurrency: int = 4
    lease_seconds: int = 120
    max_attempts: int = 3
    grace_seconds: float = 30.0

    @classmethod
    def from_settings(cls, s: Settings) -> EngineConfig:
        return cls(
            poll_seconds=s.poll_seconds,
            batch_size=s.claim_batch,
            concurrency=s.worker_concurrency,
            lease_seconds=s.lease_seconds,
            max_attempts=s.max_attempts,
            grace_seconds=s.shutdown_grace_seconds,
        )


class Engine:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        worker_id: str,
        config: EngineConfig,
        handler: Handler | None,
        stop: asyncio.Event,
    ) -> None:
        self._pool = pool
        self._worker_id = worker_id
        self._cfg = config
        self._handler = handler
        self._stop = stop
        self._wake = asyncio.Event()
        self._inflight: dict[uuid.UUID, asyncio.Task[None]] = {}
        self._log = structlog.get_logger()

    async def run(self) -> None:
        if self._handler is None:
            self._log.warning("no_stage_handler", detail="reaping only, no claims")
        background = [
            asyncio.create_task(self._reap_loop()),
            asyncio.create_task(self._lease_loop()),
        ]
        try:
            await self._claim_loop()
        finally:
            await self._drain()
            for t in background:
                t.cancel()
            await asyncio.gather(*background, return_exceptions=True)
            released = await release_claims(self._pool, self._worker_id)
            self._log.info("claims_released", count=released)

    # -- claiming ---------------------------------------------------------

    async def _claim_loop(self) -> None:
        cfg = self._cfg
        while not self._stop.is_set():
            requested = 0
            claimed = 0
            capacity = cfg.concurrency - len(self._inflight)
            if self._handler is not None and capacity > 0:
                requested = min(capacity, cfg.batch_size)
                rows: list[ClaimedRow] = []
                try:
                    rows = await claim_checks(
                        self._pool, self._worker_id, requested, cfg.lease_seconds
                    )
                except Exception:
                    self._log.exception("claim_failed")
                for row in rows:
                    self._spawn(row)
                claimed = len(rows)
            # A full batch means more work may be waiting: go again at once.
            if requested == 0 or claimed < requested:
                await self._idle(cfg.poll_seconds)

    def _spawn(self, row: ClaimedRow) -> None:
        task = asyncio.create_task(self._run_handler(row))
        self._inflight[row.id] = task
        task.add_done_callback(functools.partial(self._on_done, row.id))

    def _on_done(self, row_id: uuid.UUID, _task: asyncio.Task[None]) -> None:
        self._inflight.pop(row_id, None)
        self._wake.set()

    async def _run_handler(self, row: ClaimedRow) -> None:
        assert self._handler is not None
        structlog.contextvars.bind_contextvars(job_id=str(row.job_id), task_id=str(row.id))
        try:
            await self._handler(row)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._log.exception("handler_failed", attempts=row.attempts)

    async def _idle(self, seconds: float) -> None:
        """Sleep until stop, a finished handler, or the timeout."""
        waiters = {
            asyncio.create_task(self._stop.wait()),
            asyncio.create_task(self._wake.wait()),
        }
        _done, pending = await asyncio.wait(
            waiters, timeout=seconds, return_when=asyncio.FIRST_COMPLETED
        )
        for p in pending:
            p.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        self._wake.clear()

    # -- leases and reaper --------------------------------------------------

    async def _lease_loop(self) -> None:
        interval = self._cfg.lease_seconds / 3
        while True:
            await asyncio.sleep(interval)
            ids = list(self._inflight)
            if not ids:
                continue
            try:
                kept = await extend_leases(
                    self._pool, self._worker_id, ids, self._cfg.lease_seconds
                )
            except Exception:
                self._log.exception("lease_extend_failed")
                continue
            for rid in ids:
                task = self._inflight.get(rid)
                if rid not in kept and task is not None and not task.done():
                    self._log.warning("lease_lost", task_id=str(rid))
                    task.cancel()

    async def _reap_loop(self) -> None:
        while True:
            try:
                requeued, failed = await reap_expired(self._pool, self._cfg.max_attempts)
                if requeued or failed:
                    self._log.warning("leases_reaped", requeued=requeued, failed=failed)
            except Exception:
                self._log.exception("reap_failed")
            await asyncio.sleep(self._cfg.poll_seconds)

    # -- shutdown -----------------------------------------------------------

    async def _drain(self) -> None:
        tasks = list(self._inflight.values())
        if not tasks:
            return
        _done, pending = await asyncio.wait(tasks, timeout=self._cfg.grace_seconds)
        for t in pending:
            t.cancel()
        if pending:
            self._log.warning("handlers_cancelled", count=len(pending))
            await asyncio.gather(*pending, return_exceptions=True)
