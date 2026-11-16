"""Retry Storage cleanup after job deletion; queue rows survive failed HTTP calls."""

import asyncio

import structlog
from psycopg_pool import AsyncConnectionPool

from worker.io.storage import StorageClient


class StorageCleanupRunner:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        storage: StorageClient | None,
        poll_seconds: float,
        stop: asyncio.Event,
    ) -> None:
        self.pool, self.storage, self.poll_seconds, self.stop = pool, storage, poll_seconds, stop

    async def tick(self) -> bool:
        if self.storage is None:
            return False
        async with self.pool.connection() as conn, conn.transaction():
            row = await (
                await conn.execute(
                    """delete from public.job_storage_cleanup
                       where job_id = (
                         select job_id from public.job_storage_cleanup
                         where created_at < clock_timestamp() - interval '30 seconds'
                         order by created_at limit 1
                       ) returning job_id"""
                )
            ).fetchone()
            if row is None:
                return False
            job_id = str(row[0])
            await self.storage.delete_job_files(job_id)
            return True

    async def run(self) -> None:
        log = structlog.get_logger()
        if self.storage is None:
            log.warning(
                "job_storage_cleanup_disabled", detail="configure Supabase Storage credentials"
            )
            return
        while not self.stop.is_set():
            try:
                if await self.tick():
                    continue
            except Exception:
                log.exception("job_storage_cleanup_retry_failed")
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.poll_seconds)
            except TimeoutError:
                pass
