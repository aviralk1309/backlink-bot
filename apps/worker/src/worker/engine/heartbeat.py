"""M3-S9: worker heartbeat.

One row per worker in `worker_heartbeats`, refreshed every `interval` seconds.
A clean stop deletes the row, so the worker shows offline at once. A crash
leaves the row behind and `last_seen_at` goes stale: the dashboard treats a
row older than 3 intervals as offline (web half).

current_job_id stays null for now. The engine does not track which job its
in-flight rows belong to. Add it when the pipeline (M5) needs it.
"""

from __future__ import annotations

import asyncio

import structlog
from psycopg_pool import AsyncConnectionPool


async def upsert_heartbeat(pool: AsyncConnectionPool, worker_id: str, host: str) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "insert into public.worker_heartbeats (worker_id, host)"
            " values (%s, %s)"
            " on conflict (worker_id) do update"
            " set last_seen_at = now(), host = excluded.host",
            (worker_id, host),
        )


async def remove_heartbeat(pool: AsyncConnectionPool, worker_id: str) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "delete from public.worker_heartbeats where worker_id = %s", (worker_id,)
        )


class Heartbeat:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        worker_id: str,
        host: str,
        interval_seconds: float,
        stop: asyncio.Event,
    ) -> None:
        self._pool = pool
        self._worker_id = worker_id
        self._host = host
        self._interval = interval_seconds
        self._stop = stop
        self._log = structlog.get_logger()

    async def run(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    await upsert_heartbeat(self._pool, self._worker_id, self._host)
                except Exception:
                    self._log.exception("heartbeat_failed")
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
                except TimeoutError:
                    pass
        finally:
            try:
                await remove_heartbeat(self._pool, self._worker_id)
            except Exception:
                self._log.exception("heartbeat_remove_failed")
