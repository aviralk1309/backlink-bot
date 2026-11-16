"""Distributed admission is enforced before the real check handler runs."""

import asyncio
import os
import uuid

import psycopg
import pytest

from worker.checks.catalog import default_registry
from worker.checks.framework import CheckContext
from worker.checks.store import save_check_run
from worker.db.pool import open_pool
from worker.engine.claims import claim_checks, reap_expired, release_claims
from worker.engine.loop import Engine, EngineConfig
from worker.fetch.types import FetchResult

pytestmark = pytest.mark.integration
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


@pytest.fixture
def jobs():
    ids = []

    def create(cap=10, activities=None):
        jid = uuid.uuid4()
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "insert into public.jobs(id,name,status,per_domain_cap,activity_keys) "
                "values (%s,'S5 test','running',%s,%s)",
                (jid, cap, activities or []),
            )
        ids.append(jid)
        return jid

    yield create
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        for jid in ids:
            conn.execute("delete from public.jobs where id=%s", (jid,))


def scalar(query, args=()):
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        return conn.execute(query, args).fetchone()[0]


def seed(jid, n, domain="example.com", offset=0):
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        return [
            r[0]
            for r in conn.execute(
                """insert into public.opportunities(job_id,original_url,normalized_url,host,domain,
              first_source_type,config_version,created_at,overlap_count)
            select %s, 'https://' || %s || '/' || g, 'https://' || %s || '/' || g, %s,%s,
              'google',1,'2026-01-01'::timestamptz + make_interval(secs=>g), g
            from generate_series(%s::integer,%s::integer) g returning id""",
                (jid, domain, domain, domain, domain, offset + 1, offset + n),
            ).fetchall()
        ]


async def test_fifty_urls_four_engines_run_exactly_ten_full_checks(jobs):
    jid = jobs()
    seed(jid, 50)
    executed = []
    stop = asyncio.Event()
    cfg = EngineConfig(poll_seconds=0.02, concurrency=3, batch_size=3, lease_seconds=30)
    async with open_pool(WORKER_URL, max_size=16) as pool:

        def make(worker):
            async def handler(row):
                executed.append(row.id)
                checks = await default_registry().run(
                    CheckContext(
                        FetchResult(
                            row.original_url,
                            row.original_url,
                            "ok",
                            status_code=200,
                            text="<html><body>A page about gardening</body></html>",
                        ),
                        row.config_version,
                        robots_txt="",
                    )
                )
                async with pool.connection() as conn:
                    await save_check_run(conn, row, worker, checks)
                    await conn.execute(
                        "update public.opportunities set "
                        "check_status='done',locked_by=null,lease_expires_at=null "
                        "where id=%s and locked_by=%s",
                        (row.id, worker),
                    )

            return Engine(pool, worker, cfg, handler, stop)

        tasks = [asyncio.create_task(make(f"s5-{i}").run()) for i in range(4)]
        try:
            async with asyncio.timeout(15):
                while scalar(  # noqa: ASYNC110 - polling committed cross-process database state
                    "select count(*) from public.opportunities where job_id=%s and "
                    "check_status in ('pending','running')",
                    (jid,),
                ):
                    await asyncio.sleep(0.03)
        finally:
            stop.set()
            await asyncio.gather(*tasks)
    assert len(executed) == len(set(executed)) == 10
    assert (
        scalar(
            "select count(*) from public.opportunities where job_id=%s and "
            "check_reason='domain_cap' and check_status='skipped' and tier='unchecked'"
            " and queue_group='backlog' and attempts=0",
            (jid,),
        )
        == 40
    )
    assert (
        scalar("select admitted_count from public.domain_check_budgets where job_id=%s", (jid,))
        == 10
    )
    assert scalar("select unchecked_count from public.job_stats where job_id=%s", (jid,)) == 40
    assert (
        scalar(
            "select count(*) from public.opportunity_checks c join "
            "public.opportunities o on o.id=c.opportunity_id where o.job_id=%s",
            (jid,),
        )
        == 90
    )
    assert (
        scalar(
            "select min(overlap_count) from public.opportunities where job_id=%s and "
            "check_status='done'",
            (jid,),
        )
        == 41
    )


async def test_query_count_not_combined_source_count_breaks_ties(jobs):
    jid = jobs(cap=2)
    ids = seed(jid, 4)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("update public.opportunities set overlap_count=1 where job_id=%s", (jid,))
        conn.execute(
            "update public.opportunities set overlap_count=2, priority=9 where id=%s", (ids[3],)
        )
        conn.execute("update public.opportunities set found_by_count=100 where id=%s", (ids[0],))
        conn.execute(
            "insert into "
            "public.opportunity_sources(opportunity_id,source_type,source_ref) values "
            "(%s,'google','q1'),(%s,'google','q2'),(%s,'competitor_csv','csv')",
            (ids[2], ids[2], ids[0]),
        )
    async with open_pool(WORKER_URL) as pool:
        rows = await claim_checks(pool, "rank", 10, 30)
    assert {r.id for r in rows} == {ids[3], ids[2]}


async def test_retries_and_graceful_release_reuse_admission(jobs):
    jid = jobs(cap=2)
    seed(jid, 4)
    async with open_pool(WORKER_URL) as pool:
        first = await claim_checks(pool, "retry", 10, 30)
        assert len(first) == 2
        await release_claims(pool, "retry")
        second = await claim_checks(pool, "retry", 10, 30)
        assert {r.id for r in first} == {r.id for r in second}
        scalar(
            "update public.opportunities set lease_expires_at=now()-interval '1 "
            "second' where job_id=%s and check_status='running' returning 1",
            (jid,),
        )
        await reap_expired(pool, 3)
        third = await claim_checks(pool, "retry-2", 10, 30)
        assert {r.id for r in first} == {r.id for r in third}
    assert (
        scalar("select admitted_count from public.domain_check_budgets where job_id=%s", (jid,))
        == 2
    )


async def test_rollback_restores_admission_and_claim(jobs):
    jid = jobs(cap=1)
    seed(jid, 3)
    async with open_pool(WORKER_URL) as pool:
        with pytest.raises(RuntimeError):
            async with pool.connection() as conn:
                await conn.execute(
                    "select * from public.claim_opportunity_checks('rollback',10,30)"
                )
                raise RuntimeError("transaction interrupted")
        assert (
            scalar("select count(*) from public.domain_check_budgets where job_id=%s", (jid,)) == 0
        )
        assert (
            scalar(
                "select count(*) from public.opportunities where job_id=%s and "
                "check_status='pending'",
                (jid,),
            )
            == 3
        )
        assert len(await claim_checks(pool, "after", 10, 30)) == 1


async def test_jobs_domains_and_frozen_budget_are_independent(jobs):
    first, second = jobs(cap=2), jobs(cap=3)
    seed(first, 4)
    seed(first, 4, "other.com")
    seed(second, 4)
    async with open_pool(WORKER_URL) as pool:
        rows = await claim_checks(pool, "isolation", 20, 30)
        assert len(rows) == 7
        # Later config edits and stronger discoveries cannot refill a consumed budget.
        scalar("update public.jobs set per_domain_cap=50 where id=%s returning 1", (first,))
        seed(first, 2, offset=100)
        assert await claim_checks(pool, "later", 20, 30) == []
    assert (
        scalar(
            "select count(*) from public.opportunities where job_id=%s and "
            "check_reason='domain_cap'",
            (first,),
        )
        == 6
    )


async def test_activity_override_is_snapshotted_and_shared(jobs):
    jid = jobs(cap=1, activities=["guest_post", "resource_page"])
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "insert into public.job_config_history(job_id,version,snapshot) select "
            "id,config_version,public.job_config_snapshot(j) from public.jobs j where "
            "id=%s",
            (jid,),
        )
        expected = conn.execute(
            "select max(value::integer) from public.job_config_history h, "
            "jsonb_each_text(h.snapshot->'activity_check_caps') where h.job_id=%s",
            (jid,),
        ).fetchone()[0]
    seed(jid, expected + 3)
    async with open_pool(WORKER_URL) as pool:
        assert len(await claim_checks(pool, "override", 100, 30)) == expected
    assert (
        scalar("select cap_limit from public.domain_check_budgets where job_id=%s", (jid,))
        == expected
    )


async def test_filtered_and_merged_rows_do_not_consume_budget(jobs):
    jid = jobs(cap=1)
    ids = seed(jid, 4)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "update public.opportunities set "
            "check_status='skipped',check_reason='blocklisted',queue_group='auto_filtered',filter_reason='blocklisted'"
            " where id=%s",
            (ids[3],),
        )
        conn.execute(
            "update public.opportunities set "
            "check_status='skipped',check_reason='merged',duplicate_of=%s where id=%s",
            (ids[0], ids[2]),
        )
    async with open_pool(WORKER_URL) as pool:
        assert [r.id for r in await claim_checks(pool, "filtered", 10, 30)] == [ids[1]]
    assert (
        scalar("select admitted_count from public.domain_check_budgets where job_id=%s", (jid,))
        == 1
    )


async def test_bounded_skip_batches_eventually_drain(jobs):
    jid = jobs(cap=1)
    seed(jid, 1003)
    async with open_pool(WORKER_URL) as pool:
        assert len(await claim_checks(pool, "bounded", 10, 30)) == 1
        assert (
            scalar(
                "select count(*) from public.opportunities where job_id=%s "
                "and check_status='pending'",
                (jid,),
            )
            == 3
        )
        assert await claim_checks(pool, "drain", 10, 30) == []
        assert (
            scalar(
                "select count(*) from public.opportunities where job_id=%s "
                "and check_status='pending'",
                (jid,),
            )
            == 0
        )


async def test_equal_rank_uses_discovery_time_then_id(jobs):
    jid = jobs(cap=1)
    ids = seed(jid, 3)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "update public.opportunities set overlap_count=0,created_at='2026-01-01' "
            "where job_id=%s",
            (jid,),
        )
    async with open_pool(WORKER_URL) as pool:
        assert [row.id for row in await claim_checks(pool, "ties", 10, 30)] == [min(ids)]
