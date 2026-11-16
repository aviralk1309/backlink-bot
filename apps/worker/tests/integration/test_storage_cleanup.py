"""Deleted-job Storage cleanup retries after a failed API call."""

import asyncio
import os
import uuid

import psycopg
import pytest

from worker.db.pool import open_pool
from worker.engine.storage_cleanup import StorageCleanupRunner

pytestmark = pytest.mark.integration
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


class Storage:
    def __init__(self) -> None:
        self.fail = True
        self.deleted: list[str] = []

    async def delete_job_files(self, job_id: str) -> None:
        if self.fail:
            raise OSError("Storage unavailable")
        self.deleted.append(job_id)


async def test_failed_cleanup_is_retried() -> None:
    job_id = uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "insert into public.jobs (id, name) values (%s, 'cleanup retry test')", (job_id,)
        )
        conn.execute("delete from public.jobs where id = %s", (job_id,))
        conn.execute(
            "update public.job_storage_cleanup set created_at = '2000-01-01' where job_id = %s",
            (job_id,),
        )

    try:
        storage = Storage()
        async with open_pool(WORKER_URL) as pool:
            runner = StorageCleanupRunner(pool, storage, 1, asyncio.Event())  # type: ignore[arg-type]
            with pytest.raises(OSError, match="Storage unavailable"):
                await runner.tick()
            with psycopg.connect(ADMIN_URL) as conn:
                count = conn.execute(
                    "select count(*) from public.job_storage_cleanup where job_id = %s", (job_id,)
                ).fetchone()
                assert count == (1,)

            storage.fail = False
            assert await runner.tick()
            assert storage.deleted == [str(job_id)]
            with psycopg.connect(ADMIN_URL) as conn:
                count = conn.execute(
                    "select count(*) from public.job_storage_cleanup where job_id = %s", (job_id,)
                ).fetchone()
                assert count == (0,)
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute("delete from public.job_storage_cleanup where job_id = %s", (job_id,))
