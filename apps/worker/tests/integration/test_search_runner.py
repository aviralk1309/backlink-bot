"""M8-S4: paid query claims, discovery, retries and crash recovery on real Postgres."""

import asyncio
import json
import os
import uuid
from pathlib import Path

import psycopg
import pytest

from worker.db.pool import open_pool
from worker.engine.claims import claim_checks
from worker.engine.runner import complete_drained_jobs
from worker.engine.search import SearchRunner, claim_query, reap_expired_queries
from worker.providers.fake import FakeProvider
from worker.providers.search import (
    SearchAuthError,
    SearchResponse,
    SearchResponseError,
    SearchResult,
    SearchTimeoutError,
)

pytestmark = pytest.mark.integration
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
FIXTURE = Path(__file__).resolve().parents[4] / "fixtures/serp/search.json"


def seed_job(
    *,
    pages: int = 2,
    blocked: bool = False,
    budget_credits: int = 3,
    saturation_n: int = 20,
    saturation_x: int = 3,
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    job_id = uuid.uuid4()
    ids = [uuid.uuid4() for _ in range(pages)]
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.jobs(id,name,status,blocked_domains,budget_credits,"
            "saturation_n,saturation_x) values (%s,'M8 search','running',%s,%s,%s,%s)",
            (
                job_id,
                ["example.net"] if blocked else [],
                budget_credits,
                saturation_n,
                saturation_x,
            ),
        )
        for page, query_id in enumerate(ids, 1):
            admin.execute(
                "insert into public.job_queries(id,job_id,activity_key,template_id,"
                "template_version,query_text,gl,hl,num,page,priority) "
                "values (%s,%s,'guest_post','t1',1,'write for us','us','en',10,%s,%s)",
                (query_id, job_id, page, page),
            )
        admin.execute(
            "update public.job_stats set queries_total=%s where job_id=%s", (pages, job_id)
        )
    return job_id, ids


def remove_job(job_id: uuid.UUID) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute("delete from public.jobs where id=%s", (job_id,))


@pytest.mark.asyncio
async def test_search_flags_domains_in_confirmed_client_csv() -> None:
    job_id, _ = seed_job(pages=1)
    upload_id = uuid.uuid4()
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute(
                "insert into public.csv_uploads(id,job_id,kind,filename,storage_path,"
                "size_bytes,status,mapping,confirmed_at) "
                "values(%s,%s,'client','client.csv','test/client.csv',100,'confirmed',"
                "'{}'::jsonb,now())",
                (upload_id, job_id),
            )
            admin.execute(
                "insert into public.csv_rows(upload_id,row_no,raw_url,normalized_url,"
                "host,domain,is_valid) values(%s,1,'https://example.org/old',"
                "'https://example.org/old','example.org','example.org',true)",
                (upload_id,),
            )
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): FIXTURE}),
                "s8-flags",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select domain,client_link_status,flags->>'already_links_to_client',"
                "filter_reason from public.opportunities where job_id=%s order by domain",
                (job_id,),
            ).fetchall() == [
                ("example.net", "known_partial", None, None),
                ("example.org", "known_partial", "true", None),
            ]
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_search_records_credits_sources_blocklist_and_activity(tmp_path: Path) -> None:
    job_id, ids = seed_job(blocked=True)
    second_page = tmp_path / "page2.json"
    second_page.write_text(
        json.dumps(json.loads(FIXTURE.read_text(encoding="utf-8")) | {"credits": 2}),
        encoding="utf-8",
    )
    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): FIXTURE, ("write for us", 2): second_page}),
                "search-test",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
            assert await runner.tick()
            assert not await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select credits_used,queries_done,queries_total,unique_opportunities "
                "from public.job_stats where job_id=%s",
                (job_id,),
            ).fetchone() == (3, 2, 2, 2)
            assert admin.execute(
                "select page,status,attempts,credits_used,result_count,accepted_result_count,"
                "rejected_result_count,duplicate_result_count,new_unique_domains "
                "from public.job_queries where job_id=%s order by page",
                (job_id,),
            ).fetchall() == [
                (1, "done", 1, 1, 2, 2, 0, 0, 1),
                (2, "done", 1, 2, 2, 2, 0, 2, 0),
            ]
            assert admin.execute(
                "select count(*) from public.opportunity_sources where source_type='google' "
                "and source_ref=any(%s)",
                ([str(i) for i in ids],),
            ).fetchone() == (4,)
            assert admin.execute(
                "select activity_key,filter_reason from public.opportunities "
                "where job_id=%s order by domain",
                (job_id,),
            ).fetchall() == [("guest_post", "job_blocked_domain"), ("guest_post", None)]
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_search_rejects_google_redirect_before_discovery(tmp_path: Path) -> None:
    job_id, ids = seed_job(pages=1, budget_credits=1)
    response = tmp_path / "redirect-result.json"
    response.write_text(
        json.dumps(
            {
                "credits": 1,
                "organic": [
                    {"link": "https://www.google.com/goto?url=CAESabc", "position": 1},
                    {"link": "https://example.org/resources", "position": 2},
                    {"link": "https://example.net/write-for-us", "position": 3},
                ],
            }
        ),
        encoding="utf-8",
    )
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("update public.jobs set pages_per_query=3 where id=%s", (job_id,))
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): response}),
                "redirect-test",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select domain from public.opportunities where job_id=%s order by domain", (job_id,)
            ).fetchall() == [("example.net",), ("example.org",)]
            assert admin.execute(
                "select result_count,accepted_result_count,rejected_result_count,"
                "duplicate_result_count,new_unique_domains from public.job_queries where id=%s",
                (ids[0],),
            ).fetchone() == (3, 2, 1, 0, 2)
            assert admin.execute(
                "select count(*) from public.job_queries where job_id=%s", (job_id,)
            ).fetchone() == (1,)
            assert admin.execute(
                "select payload from public.job_events where job_id=%s "
                "and type='search_results_rejected'",
                (job_id,),
            ).fetchone() == (
                {
                    "query_id": str(ids[0]),
                    "rejected": 1,
                    "reasons": {"search_redirect": 1},
                },
            )
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_search_with_no_usable_urls_still_records_the_credit(tmp_path: Path) -> None:
    job_id, ids = seed_job(pages=1, budget_credits=1)
    response = tmp_path / "unusable-results.json"
    response.write_text(
        json.dumps(
            {
                "credits": 1,
                "organic": [
                    {"link": "https://google.com/goto?url=CAESabc", "position": 1},
                    {"link": "javascript:alert(1)", "position": 2},
                ],
            }
        ),
        encoding="utf-8",
    )
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("update public.jobs set pages_per_query=3 where id=%s", (job_id,))
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): response}),
                "unusable-test",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select count(*) from public.opportunities where job_id=%s", (job_id,)
            ).fetchone() == (0,)
            assert admin.execute(
                "select result_count,accepted_result_count,rejected_result_count,"
                "duplicate_result_count,new_unique_domains from public.job_queries where id=%s",
                (ids[0],),
            ).fetchone() == (2, 0, 2, 0, 0)
            assert admin.execute(
                "select credits_used,queries_done from public.job_stats where job_id=%s", (job_id,)
            ).fetchone() == (1, 1)
            assert admin.execute(
                "select count(*) from public.job_queries where job_id=%s", (job_id,)
            ).fetchone() == (1,)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_deeper_page_requires_new_domain_on_previous_page() -> None:
    job_id, _ = seed_job(pages=1, budget_credits=3)
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("update public.jobs set pages_per_query=3 where id=%s", (job_id,))
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): FIXTURE, ("write for us", 2): FIXTURE}),
                "adaptive-depth-test",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
            assert await runner.tick()
            assert not await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select page,new_unique_domains from public.job_queries "
                "where job_id=%s order by page",
                (job_id,),
            ).fetchall() == [(1, 2), (2, 0)]
            assert admin.execute(
                "select credits_used,queries_total,queries_done "
                "from public.job_stats where job_id=%s",
                (job_id,),
            ).fetchone() == (2, 2, 2)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_expired_claim_retries_without_duplicate_discovery() -> None:
    job_id, ids = seed_job(pages=1)
    try:
        async with open_pool(WORKER_URL) as pool:
            first = await claim_query(pool, "crashed-worker", 120, 3)
            assert first and first.id == ids[0]
            crashed = SearchRunner(
                pool, FakeProvider({}), "crashed-worker", asyncio.Event(), 0.01, 120, 3
            )
            with pytest.raises(psycopg.errors.CheckViolation):
                await crashed._save_results(
                    first,
                    SearchResponse(
                        (SearchResult("https://example.org/write-for-us", "", "", 1),),
                        -1,
                        {},
                    ),
                )
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select count(*) from public.opportunities where job_id=%s", (job_id,)
                ).fetchone() == (0,)
            with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                admin.execute(
                    "update public.job_queries set lease_expires_at=now()-interval '1 second' "
                    "where id=%s",
                    (ids[0],),
                )
            assert await reap_expired_queries(pool, 3) == 1
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): FIXTURE}),
                "replacement-worker",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
            assert not await runner._save_results(
                first, await runner.provider.search("write for us", "us", "en", None, 10, 1)
            )
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select status,attempts,credits_used,new_unique_domains "
                "from public.job_queries where id=%s",
                (ids[0],),
            ).fetchone() == ("done", 2, 1, 2)
            assert admin.execute(
                "select credits_used,queries_done,unique_opportunities "
                "from public.job_stats where job_id=%s",
                (job_id,),
            ).fetchone() == (1, 1, 2)
            assert admin.execute(
                "select count(*) from public.opportunity_sources "
                "where source_type='google' and source_ref=%s",
                (str(ids[0]),),
            ).fetchone() == (2,)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_auth_failure_fails_claim_and_stops_executor() -> None:
    job_id, ids = seed_job(pages=1)

    class AuthProvider:
        async def search(self, *args: object) -> SearchResponse:
            raise SearchAuthError("invalid key")

    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool, AuthProvider(), "auth-worker", asyncio.Event(), 0.01, 120, 3
            )
            with pytest.raises(SearchAuthError):
                await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select status,attempts from public.job_queries where id=%s", (ids[0],)
            ).fetchone() == ("failed", 1)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_missing_provider_fixture_stops_after_max_attempts() -> None:
    job_id, ids = seed_job(pages=1)
    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool, FakeProvider({}), "error-worker", asyncio.Event(), 0.01, 120, 2
            )
            assert await runner.tick()
            assert await runner.tick()
            assert not await runner.tick()
        with psycopg.connect(ADMIN_URL) as admin:
            status, attempts, error = admin.execute(
                "select status,attempts,error from public.job_queries where id=%s", (ids[0],)
            ).fetchone()
            assert (status, attempts) == ("failed", 2)
            assert "No search fixture" in error
            assert admin.execute(
                "select credits_used,queries_done from public.job_stats where job_id=%s", (job_id,)
            ).fetchone() == (0, 0)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [SearchTimeoutError, SearchResponseError])
async def test_uncertain_provider_spend_reserves_budget_without_retry(
    failure: type[Exception],
) -> None:
    job_id, ids = seed_job(pages=2, budget_credits=1)

    class UncertainProvider:
        calls = 0

        async def search(self, *args: object) -> SearchResponse:
            self.calls += 1
            raise failure("response may have been charged")

    provider = UncertainProvider()
    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool, provider, "uncertain-spend-worker", asyncio.Event(), 0.01, 120, 3
            )
            assert await runner.tick()
            assert not await runner.tick()
            assert job_id in await complete_drained_jobs(pool)
        assert provider.calls == 1
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select status,credits_used,credit_spend_uncertain from public.job_queries "
                "where id=%s",
                (ids[0],),
            ).fetchone() == ("failed", 1, True)
            assert admin.execute(
                "select status from public.job_queries where id=%s", (ids[1],)
            ).fetchone() == ("pending",)
            assert admin.execute(
                "select credits_used,credits_uncertain,queries_done from public.job_stats "
                "where job_id=%s",
                (job_id,),
            ).fetchone() == (1, 1, 0)
            assert admin.execute(
                "select payload from public.job_events where job_id=%s "
                "and type='search_spend_uncertain'",
                (job_id,),
            ).fetchone() == ({"query_id": str(ids[0]), "reserved_credits": 1},)
            assert admin.execute(
                "select status,status_reason from public.jobs where id=%s", (job_id,)
            ).fetchone() == ("completed", "budget_reached")
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_two_workers_claim_distinct_queries() -> None:
    job_id, ids = seed_job()
    try:
        async with open_pool(WORKER_URL) as pool:
            first, second = await asyncio.gather(
                claim_query(pool, "search-a", 120, 1),
                claim_query(pool, "search-b", 120, 1),
            )
            assert first and second
            assert {first.id, second.id} == set(ids)
            assert await claim_query(pool, "search-c", 120, 1) is None
            with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                admin.execute(
                    "update public.job_queries set lease_expires_at=now()-interval '1 second' "
                    "where job_id=%s",
                    (job_id,),
                )
            assert await reap_expired_queries(pool, 1) == 2
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select distinct status from public.job_queries where job_id=%s", (job_id,)
                ).fetchall() == [("failed",)]
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("budget_credits", [2, 3])
async def test_budget_serializes_two_paid_calls_and_completes_with_pending_queries(
    budget_credits: int,
) -> None:
    job_id, _ids = seed_job(pages=budget_credits, budget_credits=budget_credits)
    started = asyncio.Event()
    release = asyncio.Event()
    stop = asyncio.Event()

    class MeteredProvider:
        calls = 0
        active = 0
        peak = 0

        async def search(self, *args: object) -> SearchResponse:
            self.calls += 1
            self.active += 1
            self.peak = max(self.peak, self.active)
            if self.calls == 2:
                started.set()
            await release.wait()
            self.active -= 1
            return SearchResponse((), 2, {})

    provider = MeteredProvider()
    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(pool, provider, "budget-worker", stop, 0.01, 120, 3)
            task = asyncio.create_task(runner.run())
            try:
                await asyncio.wait_for(started.wait(), 3)
                assert await claim_query(pool, "extra-worker", 120, 3) is None
                with psycopg.connect(ADMIN_URL) as admin:
                    assert admin.execute(
                        "select count(*) from public.job_queries "
                        "where job_id=%s and status='running'",
                        (job_id,),
                    ).fetchone() == (2,)
                release.set()

                async def spent() -> None:
                    while True:
                        with psycopg.connect(ADMIN_URL) as admin:
                            row = admin.execute(
                                "select credits_used,queries_done from public.job_stats "
                                "where job_id=%s",
                                (job_id,),
                            ).fetchone()
                        if row == (4, 2):
                            return
                        await asyncio.sleep(0.01)

                await asyncio.wait_for(spent(), 3)
                stop.set()
                await asyncio.wait_for(task, 3)
                assert provider.calls == provider.peak == 2
                with psycopg.connect(ADMIN_URL) as admin:
                    counts = admin.execute(
                        "select status,count(*) from public.job_queries "
                        "where job_id=%s group by status order by status",
                        (job_id,),
                    ).fetchall()
                    assert counts == (
                        [("done", 2), ("pending", 1)] if budget_credits == 3 else [("done", 2)]
                    )
                assert job_id in await complete_drained_jobs(pool)
                with psycopg.connect(ADMIN_URL) as admin:
                    assert admin.execute(
                        "select status,status_reason from public.jobs where id=%s", (job_id,)
                    ).fetchone() == ("completed", "budget_reached")
            finally:
                release.set()
                stop.set()
                if not task.done():
                    await asyncio.wait_for(task, 3)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_budget_reached_waits_for_checks_to_drain(tmp_path: Path) -> None:
    job_id, ids = seed_job(pages=2, budget_credits=2, saturation_n=1, saturation_x=3)
    paid_response = tmp_path / "two-credits.json"
    paid_response.write_text(
        json.dumps(json.loads(FIXTURE.read_text(encoding="utf-8")) | {"credits": 2}),
        encoding="utf-8",
    )
    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool,
                FakeProvider({("write for us", 1): paid_response}),
                "drain-worker",
                asyncio.Event(),
                0.01,
                120,
                3,
            )
            assert await runner.tick()
            assert not await runner.tick()
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select status from public.jobs where id=%s", (job_id,)
                ).fetchone() == ("running",)
            assert job_id not in await complete_drained_jobs(pool)
            with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                admin.execute(
                    "update public.opportunities set check_status='done' where job_id=%s", (job_id,)
                )
            assert job_id in await complete_drained_jobs(pool)
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select status,status_reason from public.jobs where id=%s", (job_id,)
            ).fetchone() == ("completed", "budget_reached")
            assert admin.execute(
                "select status from public.job_queries where id=%s", (ids[1],)
            ).fetchone() == ("pending",)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_reported_price_increase_reserves_next_call_cost() -> None:
    job_id, ids = seed_job(pages=2, budget_credits=3)

    class TwoCreditProvider:
        async def search(self, *args: object) -> SearchResponse:
            return SearchResponse((), 2, {})

    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool, TwoCreditProvider(), "price-worker", asyncio.Event(), 0.01, 120, 3
            )
            assert await runner.tick()
            assert not await runner.tick()
            assert job_id in await complete_drained_jobs(pool)
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select credits_used,queries_done from public.job_stats where job_id=%s", (job_id,)
            ).fetchone() == (2, 1)
            assert admin.execute(
                "select status,status_reason from public.jobs where id=%s", (job_id,)
            ).fetchone() == ("completed", "budget_reached")
            assert admin.execute(
                "select status from public.job_queries where id=%s", (ids[1],)
            ).fetchone() == ("pending",)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_publication_lock_blocks_claim_until_credit_commit() -> None:
    job_id, ids = seed_job(pages=2, budget_credits=2)
    try:
        async with open_pool(WORKER_URL) as pool:
            first = await claim_query(pool, "finishing-worker", 120, 3)
            assert first and first.id == ids[0]
            async with pool.connection() as conn, conn.transaction():
                cur = await conn.execute("select public.worker_lock_search_job(%s)", (job_id,))
                assert await cur.fetchone() == (True,)
                await conn.execute(
                    "update public.job_queries set status='done',locked_by=null,"
                    "lease_expires_at=null,credits_used=2,result_count=0,"
                    "new_unique_domains=0,completed_at=now() where id=%s",
                    (first.id,),
                )
                await conn.execute("select public.job_stats_add(%s,2,1,0)", (job_id,))
                assert await asyncio.wait_for(claim_query(pool, "racing-worker", 120, 3), 2) is None
            assert await claim_query(pool, "racing-worker", 120, 3) is None
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select status from public.job_queries where id=%s", (ids[1],)
            ).fetchone() == ("pending",)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_saturation_pauses_queries_and_resumes_after_new_window() -> None:
    job_id, ids = seed_job(pages=5, budget_credits=5, saturation_n=2, saturation_x=1)

    class EmptyProvider:
        async def search(self, *args: object) -> SearchResponse:
            return SearchResponse((), 1, {})

    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool, EmptyProvider(), "saturation-worker", asyncio.Event(), 0.01, 120, 3
            )
            assert await runner.tick()
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select status from public.jobs where id=%s", (job_id,)
                ).fetchone() == ("running",)
            assert await runner.tick()
            assert not await runner.tick()
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select status,status_reason from public.jobs where id=%s", (job_id,)
                ).fetchone() == ("saturated", "low_new_domain_yield")
                assert admin.execute(
                    "select count(*) from public.job_queries where job_id=%s and status='pending'",
                    (job_id,),
                ).fetchone() == (3,)
            with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                admin.execute(
                    "select opp_id from public.record_discovery(%s,"
                    "'https://s6check.example.org/','https://s6check.example.org/',"
                    "'s6check.example.org','example.org','seed_list','saturation-check')",
                    (job_id,),
                )
            checks = await claim_checks(pool, "saturation-check-worker", 1, 120)
            assert len(checks) == 1 and checks[0].job_id == job_id
            with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
                admin.execute(
                    "select public.job_apply_transition(%s,'resume',null,null)", (job_id,)
                )
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select saturation_recheck_after from public.job_stats where job_id=%s",
                    (job_id,),
                ).fetchone() == (4,)
            assert await runner.tick()
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select status from public.jobs where id=%s", (job_id,)
                ).fetchone() == ("running",)
            assert await runner.tick()
            with psycopg.connect(ADMIN_URL) as admin:
                assert admin.execute(
                    "select status from public.jobs where id=%s", (job_id,)
                ).fetchone() == ("saturated",)
                assert admin.execute(
                    "select count(*) from public.job_queries where job_id=%s and status='pending'",
                    (job_id,),
                ).fetchone() == (1,)
    finally:
        remove_job(job_id)


@pytest.mark.asyncio
async def test_budget_completion_takes_precedence_over_saturation() -> None:
    job_id, ids = seed_job(pages=1, budget_credits=1, saturation_n=1, saturation_x=1)

    class EmptyProvider:
        async def search(self, *args: object) -> SearchResponse:
            return SearchResponse((), 1, {})

    try:
        async with open_pool(WORKER_URL) as pool:
            runner = SearchRunner(
                pool, EmptyProvider(), "budget-priority-worker", asyncio.Event(), 0.01, 120, 3
            )
            assert await runner.tick()
            assert job_id in await complete_drained_jobs(pool)
        with psycopg.connect(ADMIN_URL) as admin:
            assert admin.execute(
                "select status,status_reason from public.jobs where id=%s", (job_id,)
            ).fetchone() == ("completed", "budget_reached")
    finally:
        remove_job(job_id)
