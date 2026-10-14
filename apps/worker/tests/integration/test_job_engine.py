"""M3-S6: job engine against real Postgres, as the `worker` role.

Same env vars as test_record_discovery_race.py. Run with:
  uv run pytest -m integration

Needs a local stack with NO other pending rows in running jobs: claims are
global, so leftover rows would be claimed and break the counts.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import textwrap
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import Any

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from worker.db.pool import open_pool
from worker.engine.claims import ClaimedRow
from worker.engine.loop import Engine, EngineConfig

pytestmark = pytest.mark.integration

WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

CFG = EngineConfig(
    poll_seconds=0.2,
    batch_size=5,
    concurrency=3,
    lease_seconds=60,
    max_attempts=3,
    grace_seconds=5.0,
)


@pytest.fixture
def job_id() -> Iterator[str]:
    jid = str(uuid.uuid4())
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.jobs (id, name, status)"
            " values (%s::uuid, 'M3-S6 engine test', 'running')",
            (jid,),
        )
    try:
        yield jid
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.jobs where id = %s::uuid", (jid,))


def seed_rows(job: str, n: int) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.opportunities (job_id, original_url, normalized_url,"
            " host, domain, first_source_type, priority, config_version)"
            " select %s::uuid, 'u' || g, 'https://example.com/u' || g,"
            " 'example.com', 'example.com', 'google', 2, 1"
            " from generate_series(1, %s) g",
            (job, n),
        )


def scalar(sql: str, *params: object) -> Any:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        row = admin.execute(psycopg.sql.SQL(sql), params).fetchone()
    assert row is not None
    return row[0]


def count(job: str, where: str = "true") -> int:
    return int(
        scalar(
            f"select count(*) from public.opportunities where job_id = %s::uuid and {where}",
            job,
        )
    )


async def wait_until(pred: Callable[[], bool], limit_seconds: float = 30.0) -> None:
    deadline = time.monotonic() + limit_seconds
    while time.monotonic() < deadline:
        if pred():
            return
        await asyncio.sleep(0.1)
    raise AssertionError("condition not met in time")


async def mark_done(pool: AsyncConnectionPool, row_id: uuid.UUID, worker_id: str) -> bool:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "update public.opportunities set check_status = 'done',"
            " locked_by = null, lease_expires_at = null"
            " where id = %s and locked_by = %s and check_status = 'running'",
            (row_id, worker_id),
        )
        return cur.rowcount == 1


# ---------------------------------------------------------------------------


def test_parallel_claims_never_overlap(job_id: str) -> None:
    seed_rows(job_id, 200)
    workers = 4
    barrier = threading.Barrier(workers)

    def work(i: int) -> list[uuid.UUID]:
        got: list[uuid.UUID] = []
        with psycopg.connect(WORKER_URL) as conn:
            barrier.wait(timeout=30)
            while True:
                rows = conn.execute(
                    "select id from public.claim_opportunity_checks(%s, 7, 60)",
                    (f"par-{i}",),
                ).fetchall()
                conn.commit()
                if not rows:
                    return got
                got.extend(r[0] for r in rows)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(work, range(workers)))

    claimed = [x for r in results for x in r]
    assert len(claimed) == len(set(claimed)), "a row was claimed twice"
    assert count(job_id, "check_status = 'running' and attempts = 1") == 200


def expire_and_reap(job: str) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "update public.opportunities set lease_expires_at = now() - interval '1 second'"
            " where job_id = %s::uuid and check_status = 'running'",
            (job,),
        )
    with psycopg.connect(WORKER_URL) as conn:
        conn.execute("select * from public.reap_expired_leases(3, 500)")
        conn.commit()


def claim_as(worker: str, n: int) -> None:
    with psycopg.connect(WORKER_URL) as conn:
        conn.execute("select * from public.claim_opportunity_checks(%s, %s, 10)", (worker, n))
        conn.commit()


def test_kill_9_rows_return_then_fail_at_max_attempts(job_id: str) -> None:
    seed_rows(job_id, 5)
    code = textwrap.dedent(
        f"""
        import psycopg, time
        conn = psycopg.connect({WORKER_URL!r})
        rows = conn.execute(
            "select id from public.claim_opportunity_checks('crashy', 5, 10)"
        ).fetchall()
        conn.commit()
        print(len(rows), flush=True)
        time.sleep(600)
        """
    )
    proc = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    try:
        assert proc.stdout is not None
        assert proc.stdout.readline().strip() == "5"
        proc.kill()  # SIGKILL: no cleanup, no release
        proc.wait(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()

    assert count(job_id, "check_status = 'running' and locked_by = 'crashy'") == 5

    expire_and_reap(job_id)
    assert count(job_id, "check_status = 'pending' and attempts = 1 and locked_by is null") == 5

    for attempt in (2, 3):
        claim_as(f"retry-{attempt}", 5)
        assert count(job_id, f"check_status = 'running' and attempts = {attempt}") == 5
        expire_and_reap(job_id)

    assert count(job_id, "check_status = 'failed' and check_reason = 'max_attempts_exceeded'") == 5
    assert count(job_id) == 5, "failed rows are kept (I3)"


@pytest.mark.asyncio
async def test_two_engines_process_every_row_once(job_id: str) -> None:
    total = 60
    seed_rows(job_id, total)
    seen: list[uuid.UUID] = []
    marked: list[bool] = []

    async with open_pool(WORKER_URL, max_size=12) as pool:
        stop = asyncio.Event()

        def make(name: str) -> Engine:
            async def handler(row: ClaimedRow) -> None:
                seen.append(row.id)
                await asyncio.sleep(0.01)
                marked.append(await mark_done(pool, row.id, name))

            return Engine(pool, name, CFG, handler, stop)

        tasks = [asyncio.create_task(make(n).run()) for n in ("eng-a", "eng-b")]
        try:
            await wait_until(lambda: count(job_id, "check_status = 'done'") == total)
        finally:
            stop.set()
            await asyncio.gather(*tasks)

    assert len(seen) == total
    assert len(set(seen)) == total, "a row was processed twice"
    assert all(marked), "a handler lost its claim"


@pytest.mark.asyncio
async def test_shutdown_releases_unfinished_rows(job_id: str) -> None:
    seed_rows(job_id, 3)
    started = asyncio.Event()

    async def handler(_row: ClaimedRow) -> None:
        started.set()
        await asyncio.sleep(3600)

    async with open_pool(WORKER_URL, max_size=8) as pool:
        stop = asyncio.Event()
        engine = Engine(pool, "eng-stop", replace(CFG, grace_seconds=0.3), handler, stop)
        task = asyncio.create_task(engine.run())
        await asyncio.wait_for(started.wait(), timeout=10)
        stop.set()
        await asyncio.wait_for(task, timeout=10)

    assert count(job_id, "check_status = 'pending' and attempts = 0 and locked_by is null") == 3
