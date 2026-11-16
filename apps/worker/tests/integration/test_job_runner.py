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
from worker.engine import gap
from worker.engine.claims import ClaimedRow, claim_checks
from worker.engine.loop import Engine, EngineConfig
from worker.engine.runner import JobRunner, complete_drained_jobs

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
                " language, seed_keywords, activity_keys, competitor_domains, status)"
                " values (%s::uuid, 'M3-S7 runner test', 'client.com', 'gaming', 'US', 'en',"
                " %s, array['guest_post'], array['competitor.example'], %s::public.job_status)",
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


def configure_seed(job: str) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "update public.jobs set seed_list_urls = array['https://seed-example.org/page']"
            " where id = %s::uuid",
            (job,),
        )


def opportunity_count(job: str) -> int:
    return int(scalar("select count(*) from public.opportunities where job_id = %s::uuid", job))


def configure_gap(job: str) -> None:
    upload = uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.csv_uploads"
            " (id, job_id, kind, competitor_label, filename, storage_path, size_bytes,"
            " status, mapping, total_rows, valid_rows, confirmed_at)"
            " values (%s, %s, 'competitor', 'rival-example.org', 'test.csv', %s, 100,"
            " 'confirmed', '{\"url_index\":0}', 1, 1, now())",
            (upload, job, f"{job}/{upload}.csv"),
        )
        admin.execute(
            "insert into public.csv_rows"
            " (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)"
            " values (%s, 1, 'https://gap-example.org/page', 'https://gap-example.org/page',"
            " 'gap-example.org', 'gap-example.org', true)",
            (upload,),
        )


async def test_import_is_invisible_to_other_runners_and_check_claims(
    make_job: MakeJob,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = make_job("queued")
    configure_seed(job)
    entered, release = asyncio.Event(), asyncio.Event()
    original = gap.import_job_gap_and_seeds

    async def gated_import(conn: Any, job_id: uuid.UUID) -> gap.GapAndSeedImportResult:
        entered.set()
        await release.wait()
        return await original(conn, job_id)

    monkeypatch.setattr(gap, "import_job_gap_and_seeds", gated_import)
    async with open_pool(WORKER_URL, max_size=4) as pool:
        task = asyncio.create_task(JobRunner(pool, 0.2, asyncio.Event()).tick())
        try:
            await asyncio.wait_for(entered.wait(), 5)
            assert uuid.UUID(job) not in await complete_drained_jobs(pool)
            second = await JobRunner(pool, 0.2, asyncio.Event()).tick()
            assert second.picked_up == 0
            assert status(job) == "queued|-"
            assert await claim_checks(pool, "during-import", 10, 60) == []
        finally:
            release.set()
            await task
        assert status(job) == "running|-"
        assert opportunity_count(job) == 1


@pytest.mark.parametrize("disconnect", [False, True])
async def test_crash_after_import_rolls_back_pickup_rows_and_counters_then_recovers(
    make_job: MakeJob,
    monkeypatch: pytest.MonkeyPatch,
    disconnect: bool,
) -> None:
    job = make_job("queued")
    configure_seed(job)
    configure_gap(job)
    imported = asyncio.Event()
    release = asyncio.Event()
    backend_pid = 0
    original = gap.import_job_gap_and_seeds

    async def crash_window(conn: Any, job_id: uuid.UUID) -> gap.GapAndSeedImportResult:
        nonlocal backend_pid
        backend_pid = conn.info.backend_pid
        result = await original(conn, job_id)
        assert result.gap_opportunities_created == 1, "gap must run once, in the import savepoint"
        imported.set()
        await release.wait()
        await conn.execute("select 1")
        return result

    monkeypatch.setattr(gap, "import_job_gap_and_seeds", crash_window)
    async with open_pool(WORKER_URL, max_size=4) as pool:
        task = asyncio.create_task(JobRunner(pool, 0.2, asyncio.Event()).tick())
        try:
            await asyncio.wait_for(imported.wait(), 5)
            if disconnect:
                with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                    killed = admin.execute("select pg_terminate_backend(%s)", (backend_pid,))
                    assert killed.fetchone()[0]
                release.set()
                with pytest.raises(psycopg.OperationalError):
                    await task
            else:
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        assert status(job) == "queued|-"
        assert opportunity_count(job) == 0
        assert (
            scalar("select unique_opportunities from public.job_stats where job_id = %s", job) == 0
        )
        monkeypatch.setattr(gap, "import_job_gap_and_seeds", original)
        await JobRunner(pool, 0.2, asyncio.Event()).tick()
        assert status(job) == "running|-"
        assert opportunity_count(job) == 2
        assert scalar("select duplicates_skipped from public.job_stats where job_id = %s", job) == 0


@pytest.mark.parametrize("transient", [False, True])
async def test_import_error_is_atomic_and_not_reported_as_completion(
    make_job: MakeJob,
    monkeypatch: pytest.MonkeyPatch,
    transient: bool,
) -> None:
    job = make_job("queued")
    configure_seed(job)
    configure_gap(job)
    original = gap.import_job_gap_and_seeds

    async def broken_import(conn: Any, job_id: uuid.UUID) -> gap.GapAndSeedImportResult:
        await original(conn, job_id)
        if transient:
            raise psycopg.OperationalError("injected connection failure")
        await conn.execute("select 1 / 0")
        raise AssertionError("unreachable")

    monkeypatch.setattr(gap, "import_job_gap_and_seeds", broken_import)
    async with open_pool(WORKER_URL, max_size=4) as pool:
        runner = JobRunner(pool, 0.2, asyncio.Event())
        if transient:
            with pytest.raises(psycopg.OperationalError):
                await runner.tick()
            assert status(job) == "queued|-"
        else:
            result = await runner.tick()
            assert result.failed == 1
            assert status(job) == "failed|import_failed:DivisionByZero"
            assert (
                scalar(
                    "select count(*) from public.job_events where job_id = %s"
                    " and payload ->> 'reason' = 'import_failed:DivisionByZero'",
                    job,
                )
                == 1
            )
        assert opportunity_count(job) == 0
        assert (
            scalar("select unique_opportunities from public.job_stats where job_id = %s", job) == 0
        )
        assert scalar("select duplicates_skipped from public.job_stats where job_id = %s", job) == 0
        if transient:
            monkeypatch.setattr(gap, "import_job_gap_and_seeds", original)
            await runner.tick()
            assert opportunity_count(job) == 2
            assert status(job) == "running|-"


@pytest.mark.parametrize(("action", "expected"), [("pause", "paused"), ("stop", "stopped")])
async def test_controls_serialize_with_import_and_prevent_check_claims(
    make_job: MakeJob,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    expected: str,
) -> None:
    job = make_job("queued")
    configure_seed(job)
    entered, release = asyncio.Event(), asyncio.Event()
    original = gap.import_job_gap_and_seeds

    async def gated_import(conn: Any, job_id: uuid.UUID) -> gap.GapAndSeedImportResult:
        entered.set()
        await release.wait()
        return await original(conn, job_id)

    monkeypatch.setattr(gap, "import_job_gap_and_seeds", gated_import)
    async with open_pool(WORKER_URL, max_size=4) as pool:
        runner_task = asyncio.create_task(JobRunner(pool, 0.2, asyncio.Event()).tick())
        control_task = None
        try:
            await asyncio.wait_for(entered.wait(), 5)
            async with await psycopg.AsyncConnection.connect(ADMIN_URL) as control_conn:
                control_task = asyncio.create_task(
                    control_conn.execute(
                        "select public.job_apply_transition(%s, %s, null, null)",
                        (job, action),
                    )
                )
                try:
                    await wait_until(
                        lambda: scalar(
                            "select wait_event_type = 'Lock' from pg_stat_activity where pid = %s",
                            control_conn.info.backend_pid,
                        ),
                        limit_seconds=5,
                    )
                    assert not control_task.done()
                finally:
                    release.set()
                await asyncio.wait_for(control_task, 5)
            await runner_task
            assert status(job) == f"{expected}|-"
            assert opportunity_count(job) == 1
            assert await claim_checks(pool, "after-control", 10, 60) == []
            assert uuid.UUID(job) not in await complete_drained_jobs(pool)
        finally:
            release.set()
            if control_task is not None and not control_task.done():
                control_task.cancel()
            await asyncio.gather(
                runner_task, *([control_task] if control_task else []), return_exceptions=True
            )
