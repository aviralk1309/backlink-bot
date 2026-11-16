"""Real worker-role connections prove distributed refresh and stale-owner fencing."""

import asyncio
import os
import uuid

import psycopg
import pytest

from worker.db.pool import open_pool
from worker.fetch.domain_cache import DomainFacts, DomainFactsCache
from worker.fetch.robots import PostgresRobotsCache, RobotsPolicy
from worker.fetch.types import FetchResult

pytestmark = pytest.mark.integration
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


@pytest.fixture
def domain():
    name = f"{uuid.uuid4().hex}.com"
    yield name
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("delete from public.origin_robots_cache where registered_domain = %s", (name,))
        conn.execute("delete from public.domains where registered_domain = %s", (name,))


async def test_workers_fetch_once_and_refresh_after_ttl(domain):
    calls = 0

    async def retrieve(url):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.1)
        return FetchResult(
            url=url,
            final_url=url,
            outcome="ok",
            status_code=200,
            text="User-agent: *\nDisallow: /private",
        )

    async with open_pool(WORKER_URL) as first, open_pool(WORKER_URL) as second:
        policies = [
            RobotsPolicy(PostgresRobotsCache(p), retrieve, "BacklinkBot") for p in (first, second)
        ]
        results = await asyncio.gather(
            *(policies[i % 2].check(f"https://{domain}/private/{i}") for i in range(12))
        )
        assert results == ["robots_disallowed_for_bot"] * 12
        assert calls == 1
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "update public.origin_robots_cache set expires_at = now() - interval '1 second'"
                " where registered_domain = %s",
                (domain,),
            )
        assert await policies[0].check(f"https://{domain}/public") is None
        assert calls == 2
        assert await policies[1].check(f"http://{domain}/public") is None
        assert await policies[1].check(f"https://www.{domain}/public") is None
        assert calls == 4


async def test_lease_expiry_fences_previous_owner_and_recovers(domain):
    origin = f"https://{domain}:443"
    old, new = str(uuid.uuid4()), str(uuid.uuid4())
    async with open_pool(WORKER_URL) as pool:
        cache = PostgresRobotsCache(pool)
        assert (await cache.claim(origin, old))["action"] == "refresh"
        assert (await cache.claim(origin, new))["action"] == "wait"
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "update public.origin_robots_cache set refresh_until = now() - interval '1 second'"
                " where origin = %s",
                (origin,),
            )
        assert not await cache.complete(origin, old, "absent", "", 60)
        assert (await cache.claim(origin, new))["action"] == "refresh"
        assert not await cache.complete(origin, old, "absent", "", 60)
        assert await cache.complete(origin, new, "rules", "User-agent: *\nDisallow: /", 86400)
        assert (await cache.claim(origin, old))["state"] == "rules"


async def test_origin_cooldown_expires_without_poisoning_siblings(domain):
    origin = f"https://{domain}:443"
    async with open_pool(WORKER_URL) as pool:
        cache = PostgresRobotsCache(pool)
        token = str(uuid.uuid4())
        await cache.claim(origin, token)
        await cache.complete(origin, token, "absent", "", 86400)
        await cache.block(origin, 900)
        assert (await cache.claim(origin, token))["action"] == "blocked"
        assert (await cache.claim(f"https://www.{domain}:443", token))["action"] == "refresh"
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "update public.origin_robots_cache set blocked_until = now() - interval '1 second'"
                " where origin = %s",
                (origin,),
            )
        assert (await cache.claim(origin, token))["action"] == "cached"


async def test_domain_facts_ttl_and_moderation_preserved(domain):
    async with open_pool(WORKER_URL) as pool:
        cache = DomainFactsCache(pool)
        assert await cache.get(domain) is None
        facts = DomainFacts({"edu": False}, True, None)
        await cache.put(domain, facts)
        assert await cache.get(domain) == facts
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "update public.domains set global_spam = true, global_spam_at = now(),"
                " checked_at = now() - interval '8 days'"
                " where registered_domain = %s",
                (domain,),
            )
        assert await cache.get(domain) is None
        await cache.put(domain, facts)
        with psycopg.connect(ADMIN_URL) as conn:
            assert conn.execute(
                "select global_spam from public.domains where registered_domain = %s", (domain,)
            ).fetchone()[0]
