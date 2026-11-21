"""Separate worker pools coordinate via real PostgreSQL grants."""

import asyncio
import os
import uuid
from datetime import timedelta

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
    delay = 0.08
    async with open_pool(WORKER_URL) as first, open_pool(WORKER_URL) as second:
        limiters = [
            PostgresDomainRateLimiter(first, delay),
            PostgresDomainRateLimiter(second, delay),
        ]
        await limiters[0].acquire(domain)
        async with await psycopg.AsyncConnection.connect(ADMIN_URL) as admin:

            async def next_slot():
                row = await (
                    await admin.execute(
                        "select next_allowed_at from public.fetch_domain_limits where domain = %s",
                        (domain,),
                    )
                ).fetchone()
                assert row is not None
                return row[0]

            first_slot = await next_slot()
            await asyncio.gather(*(limiters[i % 2].acquire(domain) for i in range(5)))
            last_slot = await next_slot()
    assert last_slot - first_slot >= timedelta(seconds=5 * delay)


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
