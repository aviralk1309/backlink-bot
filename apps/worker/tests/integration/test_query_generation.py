"""M8-S3: query rows and counters commit or roll back together as worker."""

import os
import uuid

import psycopg
import pytest

from worker.db.pool import open_pool
from worker.engine.queries import create_job_queries
from worker.engine.runner import complete_drained_jobs, pick_up_next_job

pytestmark = pytest.mark.integration
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)


@pytest.mark.asyncio
async def test_query_generation_is_atomic_and_budget_bounded() -> None:
    job_id = uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.jobs(id,name,status,client_domain,business_type,country,"
            "language,seed_keywords,activity_keys,budget_credits,pages_per_query) "
            "values (%s,'M8 query plan','running','client.example','travel','US','en',"
            "array['yoga','retreat'],array['guest_post'],3,2)",
            (job_id,),
        )
    try:
        async with open_pool(WORKER_URL) as pool:
            with pytest.raises(RuntimeError, match="rollback"):
                async with pool.connection() as conn, conn.transaction():
                    await create_job_queries(conn, job_id)
                    raise RuntimeError("rollback")
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select queries_total from public.job_stats where job_id=%s", (job_id,)
                ).fetchone() == (0,)
                assert admin.execute(
                    "select count(*) from public.job_queries where job_id=%s", (job_id,)
                ).fetchone() == (0,)
            async with pool.connection() as conn, conn.transaction():
                plan = await create_job_queries(conn, job_id)
            assert len(plan.rows) == 3 and plan.capped
            async with pool.connection() as conn, conn.transaction():
                await create_job_queries(conn, job_id)
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select queries_total from public.job_stats where job_id=%s", (job_id,)
                ).fetchone() == (3,)
                assert admin.execute(
                    "select count(*),max(page) from public.job_queries where job_id=%s", (job_id,)
                ).fetchone() == (3, 1)
                assert admin.execute(
                    "select count(*) from public.job_events "
                    "where job_id=%s and type='query_plan_capped'",
                    (job_id,),
                ).fetchone() == (1,)
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.jobs where id=%s", (job_id,))


@pytest.mark.asyncio
async def test_worker_cannot_generate_queries_for_draft_job() -> None:
    job_id = uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute("insert into public.jobs(id,name) values (%s,'M8 draft')", (job_id,))
    try:
        async with open_pool(WORKER_URL) as pool, pool.connection() as conn:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                await conn.execute(
                    "insert into public.job_queries(job_id,activity_key,template_id,"
                    "template_version,query_text) values (%s,'guest_post','t1',1,'draft query')",
                    (job_id,),
                )
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.jobs where id=%s", (job_id,))


@pytest.mark.asyncio
async def test_pickup_publishes_queries_before_job_can_complete() -> None:
    job_id = uuid.uuid4()
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        queued = admin.execute("select count(*) from public.jobs where status='queued'").fetchone()
        assert queued == (0,), "Query pickup test needs an idle local job queue"
        admin.execute(
            "insert into public.jobs(id,name,status,client_domain,business_type,country,"
            "language,seed_keywords,activity_keys,budget_credits) "
            "values (%s,'M8 pickup','queued','client.example','travel','US','en',"
            "array['yoga'],array['guest_post'],2)",
            (job_id,),
        )
    try:
        async with open_pool(WORKER_URL) as pool:
            assert await pick_up_next_job(pool) == (job_id, "running")
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select queries_total from public.job_stats where job_id=%s", (job_id,)
                ).fetchone() == (2,)
                assert admin.execute(
                    "select count(*) from public.job_queries where job_id=%s", (job_id,)
                ).fetchone() == (2,)
            assert job_id not in await complete_drained_jobs(pool)
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.jobs where id=%s", (job_id,))
