"""Separate worker pools coordinate via real PostgreSQL grants."""

import asyncio
import os
import time
import uuid

import psycopg
import pytest

from worker.db.pool import open_pool
from worker.fetch.rate_limiter import PostgresDomainRateLimiter

pytestmark = pytest.mark.integration
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


@pytest.fixture
def domain():
    key = f"{uuid.uuid4().hex}.example"
    yield key
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "delete from public.fetch_domain_limits where domain in (%s, %s)", (key, "other." + key)
        )


async def test_independent_worker_pools_share_domain_slots(domain):
    async with open_pool(WORKER_URL) as first, open_pool(WORKER_URL) as second:
        limiters = [PostgresDomainRateLimiter(first, 0.08), PostgresDomainRateLimiter(second, 0.08)]
        grants = []

        async def acquire(limiter):
            await limiter.acquire(domain)
            grants.append(time.monotonic())

        await asyncio.gather(*(acquire(limiters[i % 2]) for i in range(6)))
    assert len(grants) == 6
    assert all(b - a >= 0.065 for a, b in zip(grants, grants[1:], strict=False))


async def test_cancelled_waiter_does_not_reserve_future_slots(domain):
    async with open_pool(WORKER_URL) as pool:
        limiter = PostgresDomainRateLimiter(pool, 0.2)
        await limiter.acquire(domain)
        task = asyncio.create_task(limiter.acquire(domain))
        await asyncio.sleep(0.03)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # Other domains are not delayed by this domain or a sleeping waiter.
        await asyncio.wait_for(limiter.acquire("other." + domain), 0.15)
        await asyncio.sleep(0.22)
        await asyncio.wait_for(limiter.acquire(domain), 0.15)
