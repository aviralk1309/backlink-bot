"""M3-S7: job runner against real Postgres, as the `worker` role.

Same env vars as test_job_engine.py. Run with: uv run pytest -m integration

The runner picks up EVERY queued job and completes EVERY drained running job
in the local DB. Run these tests on a dev DB with no other queued jobs.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from worker.db.pool import open_pool
from worker.engine.claims import ClaimedRow
from worker.engine.loop import Engine, EngineConfig
from worker.engine.runner import JobRunner

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

MakeJob = Callable[..., str]


@pytest.fixture
def make_job() -> Iterator[MakeJob]:
    created: list[str] = []

    def factory(status: str, seed_keywords: list[str] | None = None) -> str:
        jid = str(uuid.uuid4())
        keywords = ["keyword"] if seed_keywords is None else seed_keywords
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute(
                "insert into public.jobs (id, name, client_domain, business_type, country,"
                " language, seed_keywords, activity_keys, budget_credits, status)"
                " values (%s::uuid, 'M3-S7 runner test', 'client.com', 'gaming', 'US', 'en',"
                " %s, array['guest_post'], 100, %s::public.job_status)",
                (jid, keywords, status),
            )
        created.append(jid)
        return jid

    yield factory
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        for jid in created:
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
        row = admin.execute(sql, params).fetchone()
    assert row is not None
    return row[0]


def status(job: str) -> str:
    """'status|reason', '-' when there is no reason."""
    return str(
        scalar(
            "select status::text || '|' || coalesce(status_reason, '-')"
            " from public.jobs where id = %s::uuid",
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


@pytest.mark.asyncio
async def test_job_without_rows_runs_and_completes(make_job: MakeJob) -> None:
    job = make_job("queued")
    async with open_pool(WORKER_URL, max_size=4) as pool:
        stop = asyncio.Event()
        task = asyncio.create_task(JobRunner(pool, 0.2, stop).run())
        try:
            await wait_until(lambda: status(job) == "completed|drained")
        finally:
            stop.set()
            await task
    assert scalar("select finished_at is not null from public.jobs where id = %s::uuid", job)


@pytest.mark.asyncio
async def test_bad_config_fails_at_pick_up(make_job: MakeJob) -> None:
    job = make_job("queued", seed_keywords=[])
    async with open_pool(WORKER_URL, max_size=4) as pool:
        stop = asyncio.Event()
        task = asyncio.create_task(JobRunner(pool, 0.2, stop).run())
        try:
            await wait_until(lambda: status(job).startswith("failed"))
        finally:
            stop.set()
            await task
    assert status(job) == "failed|bad_config:missing_seed_keywords"


@pytest.mark.asyncio
async def test_job_completes_only_after_rows_drain(make_job: MakeJob) -> None:
    job = make_job("queued")
    seed_rows(job, 6)
    gate = asyncio.Event()

    async with open_pool(WORKER_URL, max_size=12) as pool:
        stop = asyncio.Event()

        async def handler(row: ClaimedRow) -> None:
            await gate.wait()
            await mark_done(pool, row.id, "eng-run")

        engine = Engine(pool, "eng-run", CFG, handler, stop)
        runner = JobRunner(pool, 0.2, stop)
        tasks = [asyncio.create_task(engine.run()), asyncio.create_task(runner.run())]
        try:
            await wait_until(lambda: status(job) == "running|-")
            await asyncio.sleep(1.0)  # several ticks with the handler blocked
            assert status(job) == "running|-", "completed while rows were open"
            open_rows = scalar(
                "select count(*) from public.opportunities where job_id = %s::uuid"
                " and check_status in ('pending', 'running')",
                job,
            )
            assert open_rows == 6

            gate.set()
            await wait_until(lambda: status(job) == "completed|drained")
        finally:
            gate.set()
            stop.set()
            await asyncio.gather(*tasks)

    done = scalar(
        "select count(*) from public.opportunities where job_id = %s::uuid"
        " and check_status = 'done'",
        job,
    )
    assert done == 6


@pytest.mark.asyncio
async def test_paused_job_is_not_completed(make_job: MakeJob) -> None:
    job = make_job("paused")
    async with open_pool(WORKER_URL, max_size=4) as pool:
        stop = asyncio.Event()
        task = asyncio.create_task(JobRunner(pool, 0.2, stop).run())
        try:
            await asyncio.sleep(1.0)
            assert status(job) == "paused|-"

            with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                admin.execute(
                    "update public.jobs set status = 'running' where id = %s::uuid", (job,)
                )
            await wait_until(lambda: status(job) == "completed|drained")
        finally:
            stop.set()
            await task
