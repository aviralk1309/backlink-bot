"""Retry Storage cleanup after deletion; queue rows survive failed HTTP calls."""

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
            candidate = await (
                await conn.execute(
                    """select kind, path from (
                         select 'job' as kind, job_id::text as path, created_at
                         from public.job_storage_cleanup
                         where created_at < clock_timestamp() - interval '30 seconds'
                         union all
                         select 'file', path, created_at
                         from public.csv_storage_cleanup
                         where created_at < clock_timestamp() - interval '30 seconds'
                       ) ready order by created_at limit 1"""
                )
            ).fetchone()
            if candidate is None:
                return False
            kind, path = candidate
            table = "job_storage_cleanup" if kind == "job" else "csv_storage_cleanup"
            column = "job_id" if kind == "job" else "path"
            row = await (
                await conn.execute(
                    f"delete from public.{table} where {column} = %s returning {column}",
                    (path,),
                )
            ).fetchone()
            if row is None:
                return False
            if kind == "job":
                await self.storage.delete_job_files(str(path))
            else:
                await self.storage.delete_file(str(path))
            return True

    async def run(self) -> None:
        log = structlog.get_logger()
        if self.storage is None:
            log.warning("storage_cleanup_disabled", detail="configure Supabase Storage credentials")
            return
        while not self.stop.is_set():
            try:
                if await self.tick():
                    continue
            except Exception:
                log.exception("storage_cleanup_retry_failed")
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.poll_seconds)
            except TimeoutError:
                pass
