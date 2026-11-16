"""M5 end-to-end: gap rows travel through claims, checks, scores and queues."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from worker.checks.inputs import ActivityProfile
from worker.engine.loop import Engine, EngineConfig
from worker.fetch.types import FetchResult
from worker.stages.opportunity import OpportunityHandler

pytestmark = pytest.mark.integration
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
FIXTURES = Path(__file__).parents[1] / "fixtures/checks"


class FixtureFetcher:
    """Replace only the network boundary; the worker, checks and SQL stay real."""

    def __init__(self, pages: dict[str, str]) -> None:
        self.pages = pages
        self.calls: list[str] = []

    async def fetch(self, url: str) -> FetchResult:
        self.calls.append(url)
        return FetchResult(
            url=url,
            final_url=url,
            outcome="ok",
            status_code=200,
            text=self.pages[url],
            headers={"content-type": "text/html"},
            robots_txt="",
        )


async def _wait_until_done(pool: AsyncConnectionPool[Any], job_id: uuid.UUID) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        async with pool.connection() as conn:
            cursor = await conn.execute(
                "select count(*) from public.opportunities where job_id=%s and check_status='done'",
                (job_id,),
            )
            row = await cursor.fetchone()
        if row is not None and row[0] == 4:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("all fixture opportunities did not finish the worker pipeline")


def _assert_queue_idle() -> None:
    with psycopg.connect(ADMIN_URL) as conn:
        pending = conn.execute(
            "select exists(select 1 from public.jobs j join public.opportunities o "
            "on o.job_id=j.id where j.status in ('running','saturated') "
            "and o.check_status='pending' and o.duplicate_of is null)"
        ).fetchone()
    assert pending is not None and not pending[0], (
        "M5 pipeline E2E needs an idle local worker queue"
    )


@pytest.mark.asyncio
async def test_gap_fixture_job_reaches_ranked_ready_backlog_and_filter_queues() -> None:
    _assert_queue_idle()
    job_id = uuid.uuid4()
    profile_key = f"m5e2e_{job_id.hex[:12]}"
    worker_id = f"m5-e2e-{job_id.hex[:8]}"
    cases = (
        ("guest_post.html", 1),
        ("guest_post.html", 2),
        ("guest_post.html", 3),
        ("noindex.html", 0),
    )
    domains = [f"m5e2e{job_id.hex[:10]}{index}.com" for index in range(len(cases))]
    urls = [f"https://{domain}/source/{index}" for index, domain in enumerate(domains)]
    fetcher = FixtureFetcher(
        {
            url: (FIXTURES / fixture).read_text(encoding="utf-8")
            for url, (fixture, _) in zip(urls, cases, strict=True)
        }
    )
    profile = ActivityProfile(
        key=profile_key,
        page_type_signals={
            "url_patterns": ["write-for-us", "contribute"],
            "title_phrases": ["write for us"],
            "heading_phrases": ["guest post guidelines"],
            "body_phrases": ["contributors"],
        },
    )

    try:
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(
                "insert into public.activity_profiles(key,name,page_type_signals) "
                "values (%s,%s,%s)",
                (profile_key, "M5 pipeline fixture", Jsonb(profile.page_type_signals.model_dump())),
            )
            conn.execute(
                "insert into public.jobs(id,name,status,activity_keys,language,seed_keywords,"
                "banned_categories,per_domain_cap,review_queue_size) "
                "values (%s,%s,'running',%s,'en',%s,%s,10,2)",
                (
                    job_id,
                    f"M5 pipeline E2E {job_id}",
                    [profile_key],
                    ["sustainable gardening", "garden soil"],
                    ["gambling", "pharma"],
                ),
            )
            conn.execute(
                "insert into public.job_config_history(job_id,version,snapshot) "
                "select j.id,j.config_version,public.job_config_snapshot(j) "
                "from public.jobs j where j.id=%s",
                (job_id,),
            )
            for index, (url, domain, (_, overlap)) in enumerate(
                zip(urls, domains, cases, strict=True)
            ):
                result = conn.execute(
                    "select opp_id,created,source_added from public.record_discovery"
                    "(%s,%s,%s,%s,%s,'competitor_csv',%s,%s)",
                    (
                        job_id,
                        url,
                        url,
                        domain,
                        domain,
                        f"competitor-{index}",
                        Jsonb({"overlap_count": overlap}),
                    ),
                ).fetchone()
                assert result is not None and result[1:] == (True, True)

        async with AsyncConnectionPool(WORKER_URL, min_size=1, max_size=12) as pool:
            stop = asyncio.Event()
            handler = OpportunityHandler(pool, worker_id, fetcher)  # type: ignore[arg-type]
            engine = Engine(
                pool,
                worker_id,
                EngineConfig(
                    poll_seconds=0.05,
                    batch_size=4,
                    concurrency=4,
                    lease_seconds=30,
                    max_attempts=2,
                    grace_seconds=3,
                ),
                handler,
                stop,
            )
            task = asyncio.create_task(engine.run())
            try:
                await _wait_until_done(pool, job_id)
            finally:
                stop.set()
                await asyncio.wait_for(task, timeout=10)

            async with pool.connection() as conn:
                cursor = await conn.execute(
                    "select normalized_url,check_status::text,queue_group::text,score,tier::text,"
                    "locked_by,lease_expires_at,fetch_summary,filter_reason,first_ready "
                    "from public.opportunities where job_id=%s "
                    "order by score desc nulls last,overlap_count desc",
                    (job_id,),
                )
                rows = await cursor.fetchall()
                cursor = await conn.execute(
                    "select count(*) from public.opportunity_checks c "
                    "join public.opportunities o on o.id=c.opportunity_id where o.job_id=%s",
                    (job_id,),
                )
                check_count = (await cursor.fetchone())[0]
                cursor = await conn.execute(
                    "select unique_opportunities,unchecked_count from public.job_stats "
                    "where job_id=%s",
                    (job_id,),
                )
                counters = await cursor.fetchone()

        assert len(fetcher.calls) == 4
        assert len(set(fetcher.calls)) == 4
        assert len(rows) == 4
        assert check_count == 4 * 9
        assert counters == (4, 0)
        assert [row[2] for row in rows].count("ready") == 2
        assert [row[2] for row in rows].count("backlog") == 1
        assert [row[2] for row in rows].count("auto_filtered") == 1
        ranked = [row for row in rows if row[2] in ("ready", "backlog")]
        assert all(row[1] == "done" and row[5] is None and row[6] is None for row in rows)
        assert [row[3] for row in ranked] == sorted((row[3] for row in ranked), reverse=True)
        assert len({row[3] for row in ranked}) == 3
        assert all(row[7]["outcome"] == "ok" for row in rows)
        filtered = next(row for row in rows if row[2] == "auto_filtered")
        assert filtered[8] == "meta_noindex" and filtered[3] is None
        assert sum(bool(row[9]) for row in rows) == 2
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute("delete from public.jobs where id=%s", (job_id,))
            conn.execute("delete from public.activity_profiles where key=%s", (profile_key,))
            conn.execute("delete from public.domains where registered_domain=any(%s)", (domains,))
