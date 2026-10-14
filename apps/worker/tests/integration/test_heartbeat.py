"""M3-S9: heartbeat row appears, advances, and is removed on a clean stop."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Callable
from datetime import datetime

import psycopg
import pytest

from worker.db.pool import open_pool
from worker.engine.heartbeat import Heartbeat

pytestmark = pytest.mark.integration

WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


def last_seen(worker_id: str) -> datetime | None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        row = admin.execute(
            "select last_seen_at from public.worker_heartbeats where worker_id = %s",
            (worker_id,),
        ).fetchone()
    return row[0] if row else None


async def wait_until(pred: Callable[[], bool], limit_seconds: float = 15.0) -> None:
    deadline = time.monotonic() + limit_seconds
    while time.monotonic() < deadline:
        if pred():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition not met in time")


@pytest.mark.asyncio
async def test_heartbeat_appears_advances_and_is_removed_on_stop() -> None:
    wid = f"hb-test-{uuid.uuid4().hex[:6]}"
    try:
        async with open_pool(WORKER_URL, max_size=3) as pool:
            stop = asyncio.Event()
            task = asyncio.create_task(Heartbeat(pool, wid, "test-host", 0.2, stop).run())
            try:
                await wait_until(lambda: last_seen(wid) is not None)
                first = last_seen(wid)
                assert first is not None
                await wait_until(lambda: (last_seen(wid) or first) > first)
            finally:
                stop.set()
                await task
        assert last_seen(wid) is None, "a clean stop removes the row"
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.worker_heartbeats where worker_id = %s", (wid,))
