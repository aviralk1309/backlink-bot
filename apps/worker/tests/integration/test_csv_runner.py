"""CSV claim recovery against local Postgres; Storage is an in-memory fixture."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest

from worker.config.settings import Settings
from worker.db.pool import open_pool
from worker.engine import csv_runner
from worker.engine.csv_runner import CsvRunner

pytestmark = pytest.mark.integration
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


def query(sql: str, *args: object) -> Any:
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        return conn.execute(sql, args).fetchall()


@pytest.fixture
def upload_id() -> Iterator[uuid.UUID]:
    job, upload = uuid.uuid4(), uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("insert into public.jobs(id, name) values (%s, 'CSV recovery test')", (job,))
        conn.execute(
            "insert into public.csv_uploads"
            " (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)"
            " values (%s, %s, 'client', 'test.csv', %s, 100, 'mapped', '{\"url_index\":0}')",
            (upload, job, f"{job}/{upload}.csv"),
        )
    yield upload
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("delete from public.jobs where id = %s", (job,))


def expire(upload: uuid.UUID) -> None:
    # Also runs on the old schema to reproduce the stranded-processing defect.
    has_lease = query(
        "select exists(select 1 from information_schema.columns where table_schema = 'public'"
        " and table_name = 'csv_uploads' and column_name = 'lease_expires_at')"
    )[0][0]
    if has_lease:
        query(
            "update public.csv_uploads"
            " set lease_expires_at = clock_timestamp() - interval '1 second'"
            " where id = %s returning id",
            upload,
        )
    else:
        query(
            "update public.csv_uploads set updated_at = now() - interval '1 day'"
            " where id = %s returning id",
            upload,
        )


class Storage:
    body = b"URL\nhttps://example.org/page\n"

    def __init__(self) -> None:
        self.reports: dict[str, bytes] = {}

    async def download_file(self, bucket: str, path: str, dest_path: Path) -> None:
        await asyncio.to_thread(dest_path.write_bytes, self.body)

    async def upload_file(self, bucket: str, path: str, content: Path) -> None:
        self.reports[path] = await asyncio.to_thread(content.read_bytes)


def runner(pool: Any, **settings: object) -> CsvRunner:
    config = Settings(database_url=WORKER_URL, _env_file=None, **settings)
    result = CsvRunner(pool, config, asyncio.Event(), max_pickups_per_tick=1)
    result._storage = Storage()  # type: ignore[assignment]
    return result


async def test_abandoned_processing_upload_is_recovered(upload_id: uuid.UUID) -> None:
    async with open_pool(WORKER_URL) as pool:
        first = runner(pool)
        claim = await first._claim_next()
        assert claim and claim["id"] == upload_id
        expire(upload_id)  # worker died after the claim committed
        await runner(pool).tick()
    assert query(
        "select status::text, valid_rows from public.csv_uploads where id = %s", upload_id
    ) == [("ready", 1)]


def state(upload: uuid.UUID, columns: str) -> tuple[Any, ...]:
    return tuple(query(f"select {columns} from public.csv_uploads where id = %s", upload)[0])


async def test_two_workers_cannot_claim_the_same_upload(upload_id: uuid.UUID) -> None:
    async with open_pool(WORKER_URL) as pool:
        claims = await asyncio.gather(runner(pool)._claim_next(), runner(pool)._claim_next())
    claimed = [item for item in claims if item]
    assert len(claimed) == 1
    assert claimed[0]["id"] == upload_id
    assert claimed[0]["claim_token"]
    assert claimed[0]["processing_attempts"] == 1


async def test_expired_attempt_cannot_overwrite_new_attempt(upload_id: uuid.UUID) -> None:
    async with open_pool(WORKER_URL) as pool:
        old, new = runner(pool), runner(pool)
        stale = await old._claim_next()
        assert stale
        expire(upload_id)
        assert await new._reap() == 1
        current = await new._claim_next()
        assert current and current["claim_token"] != stale["claim_token"]
        assert not await old._renew(stale)
        await old._fail_upload(stale, "stale_failure")
        assert state(upload_id, "claim_token")[0] == current["claim_token"]
        await new._process_upload(current)
        old._storage.body = b"URL\nhttps://wrong.example.org/stale\n"
        await old._process_upload(stale)
        await old._fail_upload(stale, "stale_failure_after_success")
    assert state(upload_id, "status::text, status_reason, processing_attempts") == (
        "ready",
        None,
        2,
    )
    assert query("select normalized_url from public.csv_rows where upload_id = %s", upload_id) == [
        ("https://example.org/page",)
    ]


async def test_repeated_crashes_end_in_visible_failure(upload_id: uuid.UUID) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool)
        tokens = set()
        for attempt in range(1, 4):
            claim = await worker._claim_next()
            assert claim and claim["processing_attempts"] == attempt
            tokens.add(claim["claim_token"])
            expire(upload_id)
            assert await worker._reap() == 1
        assert len(tokens) == 3
        assert await worker._claim_next() is None
        assert await worker._reap() == 0
    assert state(upload_id, "status::text, status_reason, claim_token") == (
        "failed",
        "csv_attempts_exhausted",
        None,
    )


async def test_download_renews_lease_and_cancellation_releases_claim(
    upload_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool, csv_lease_seconds=10)
        claim = await worker._claim_next()
        assert claim
        deadline = state(upload_id, "lease_expires_at")[0]
        renewed = asyncio.Event()
        original = worker._renew

        async def renew(item: dict[str, Any]) -> bool:
            result = await original(item)
            renewed.set()
            return result

        async def download(*args: object) -> None:
            await asyncio.Event().wait()

        monkeypatch.setattr(worker, "_renew", renew)
        monkeypatch.setattr(worker._storage, "download_file", download)
        task = asyncio.create_task(worker._process_upload(claim))
        try:
            await asyncio.wait_for(renewed.wait(), 6)
            assert state(upload_id, "lease_expires_at")[0] > deadline
            assert await worker._reap() == 0
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
    assert state(upload_id, "status::text, claim_token") == ("mapped", None)


async def test_download_errors_retry_only_to_limit(
    upload_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool)

        async def broken(*args: object) -> None:
            raise httpx.ConnectError("injected unavailable storage")

        monkeypatch.setattr(worker._storage, "download_file", broken)
        for expected in ("mapped", "mapped", "failed"):
            assert await worker.tick() == 1
            assert state(upload_id, "status::text")[0] == expected
        assert await worker.tick() == 0


async def test_database_disconnect_rolls_back_staging_and_retry_uses_new_report(
    upload_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool)
        worker._storage.body = (
            b"URL,Anchor\nhttps://example.org/one,a\nbad-url,b\nhttps://example.org/one,c\n,empty\n"
        )
        claim = await worker._claim_next()
        assert claim
        local = tmp_path / "source.csv"
        await worker._storage.download_file("csv-uploads", "test", local)
        entered, release = asyncio.Event(), asyncio.Event()
        original = csv_runner.validate_and_stage_csv
        backend_pid = 0

        async def interrupted(**kwargs: Any) -> Any:
            nonlocal backend_pid
            backend_pid = kwargs["conn"].info.backend_pid
            result = await original(**kwargs)
            entered.set()
            await release.wait()
            return result

        monkeypatch.setattr(csv_runner, "validate_and_stage_csv", interrupted)
        task = asyncio.create_task(worker._stage(claim, local))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            assert query("select pg_terminate_backend(%s)", backend_pid)[0][0]
            release.set()
            with pytest.raises(psycopg.OperationalError):
                await task
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
        assert (
            query("select count(*) from public.csv_rows where upload_id = %s", upload_id)[0][0] == 0
        )
        expire(upload_id)
        await worker._reap()
        next_claim = await worker._claim_next()
        assert next_claim
        monkeypatch.setattr(csv_runner, "validate_and_stage_csv", original)
        await worker._process_upload(next_claim)
        result = state(
            upload_id,
            "status::text, total_rows, valid_rows, invalid_rows, empty_rows,"
            " duplicate_rows, error_report_path",
        )
        assert result[:6] == ("ready", 4, 2, 1, 1, 1)
        assert str(next_claim["claim_token"]) in result[6]
        assert len(worker._storage.reports) == 2
        assert (
            query("select count(*) from public.csv_rows where upload_id = %s", upload_id)[0][0] == 4
        )


async def test_staging_timeout_releases_lock_and_requeues(
    upload_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool, csv_processing_timeout_seconds=0.2)

        async def stuck(**kwargs: Any) -> Any:
            await asyncio.Event().wait()

        monkeypatch.setattr(csv_runner, "validate_and_stage_csv", stuck)
        await asyncio.wait_for(worker.tick(), 3)
    assert state(upload_id, "status::text, claim_token") == ("mapped", None)


async def test_row_limit_rolls_back_flushed_batches_and_marks_failed(upload_id: uuid.UUID) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool, csv_max_rows=1001)
        worker._storage.body = b"URL\n" + b"https://example.org/a\n" * 1002
        assert await worker.tick() == 1
        assert await worker.tick() == 0  # permanent input limit, not retried
    assert state(upload_id, "status::text, status_reason, claim_token") == (
        "failed",
        "csv_row_limit_exceeded:1001",
        None,
    )
    assert query("select count(*) from public.csv_rows where upload_id = %s", upload_id)[0][0] == 0


async def test_exact_limit_and_duplicates_across_batches(upload_id: uuid.UUID) -> None:
    async with open_pool(WORKER_URL) as pool:
        worker = runner(pool, csv_max_rows=1002)
        worker._storage.body = (
            b"URL\n"
            + b"".join(f"https://example.org/{i}\n".encode() for i in range(1001))
            + b"https://example.org/0?utm_source=test\n"
        )
        assert await worker.tick() == 1
    assert state(upload_id, "status::text, total_rows, valid_rows, duplicate_rows") == (
        "ready",
        1002,
        1002,
        1,
    )
    assert query(
        "select is_duplicate from public.csv_rows where upload_id = %s "
        "order by row_no desc limit 1",
        upload_id,
    )[0][0]
