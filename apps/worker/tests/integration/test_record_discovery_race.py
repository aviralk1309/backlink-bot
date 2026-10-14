"""M3-S4: record_discovery and merge_opportunity_after_fetch under real concurrency.

Each thread uses its own connection as the `worker` role, so these are real
parallel transactions, not interleaved calls on one connection.

Needs the local Supabase stack with migrations applied and the worker role
able to log in (supabase/seed.sql). Run with: uv run pytest -m integration

Env (both optional, local defaults shown):
  TEST_WORKER_DATABASE_URL  postgresql://worker:worker@127.0.0.1:54322/postgres
  TEST_ADMIN_DATABASE_URL   postgresql://postgres:postgres@127.0.0.1:54322/postgres
The admin URL only creates and removes the test job. The calls under test use
the worker URL.
"""

from __future__ import annotations

import os
import random
import threading
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import psycopg
import pytest
from psycopg import errors

pytestmark = pytest.mark.integration

WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

Conn = psycopg.Connection[tuple[Any, ...]]
Discovery = tuple[uuid.UUID, bool, bool, bool]


@pytest.fixture
def job_id() -> Iterator[str]:
    jid = str(uuid.uuid4())
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.jobs (id, name) values (%s::uuid, %s)",
            (jid, "M3-S4 race test"),
        )
    try:
        yield jid
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.jobs where id = %s::uuid", (jid,))


def discover(conn: Conn, job: str, dom: str, path: str, stype: str, ref: str) -> Discovery:
    row = conn.execute(
        "select opp_id, created, source_added, domain_added"
        " from public.record_discovery(%s::uuid, %s, %s, %s, %s, %s, %s)",
        (
            job,
            f"http://ORIG.{dom}/{path}",
            f"https://{dom}/{path}",
            dom,
            dom,
            stype,
            ref,
        ),
    ).fetchone()
    conn.commit()
    assert row is not None
    return (row[0], row[1], row[2], row[3])


def merge(conn: Conn, opp: uuid.UUID, final_url: str) -> tuple[str, uuid.UUID]:
    """The caller contract: retry on 40001 (the merge target changed under the lock)."""
    for _ in range(5):
        try:
            row = conn.execute(
                "select outcome, canonical_id"
                " from public.merge_opportunity_after_fetch(%s::uuid, %s)",
                (opp, final_url),
            ).fetchone()
            conn.commit()
            assert row is not None
            return (row[0], row[1])
        except errors.SerializationFailure:
            conn.rollback()
    raise AssertionError("merge kept failing with 40001")


def run_parallel(n: int, fn: Callable[[int, Conn], Any]) -> list[Any]:
    """Run fn in n threads, each with its own worker connection, released together."""
    barrier = threading.Barrier(n)

    def task(i: int) -> Any:
        with psycopg.connect(WORKER_URL) as conn:
            barrier.wait(timeout=30)
            return fn(i, conn)

    with ThreadPoolExecutor(max_workers=n) as pool:
        futures = [pool.submit(task, i) for i in range(n)]
        return [f.result(timeout=120) for f in futures]


def scalar(sql: str, *params: object) -> Any:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        row = admin.execute(psycopg.sql.SQL(sql), params).fetchone()
    assert row is not None
    return row[0]


def stats(job: str) -> tuple[int, int]:
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        row = admin.execute(
            "select unique_opportunities, duplicates_skipped from public.job_stats"
            " where job_id = %s::uuid",
            (job,),
        ).fetchone()
    assert row is not None
    return (row[0], row[1])


def test_same_url_different_sources_one_row_all_sources(job_id: str) -> None:
    n = 8
    results = run_parallel(n, lambda i, c: discover(c, job_id, "race.com", "p", "google", f"q-{i}"))
    assert sum(r[1] for r in results) == 1, "exactly one caller inserts the row"
    assert all(r[2] for r in results), "every caller's source is recorded"
    assert sum(r[3] for r in results) == 1, "exactly one caller sees the domain as new"
    assert len({r[0] for r in results}) == 1, "all callers get the same row"

    assert scalar("select count(*) from public.opportunities where job_id = %s::uuid", job_id) == 1
    assert (
        scalar(
            "select found_by_count from public.opportunities where job_id = %s::uuid",
            job_id,
        )
        == n
    )
    assert (
        scalar(
            "select count(*) from public.opportunity_sources where opportunity_id = %s",
            results[0][0],
        )
        == n
    )
    assert stats(job_id) == (1, n - 1)


def test_same_url_same_source_replay_race_counts_once(job_id: str) -> None:
    results = run_parallel(8, lambda i, c: discover(c, job_id, "race.com", "p", "google", "q-1"))
    assert sum(r[1] for r in results) == 1
    assert sum(r[2] for r in results) == 1, "only one source record is inserted"
    assert scalar("select count(*) from public.opportunities where job_id = %s::uuid", job_id) == 1
    assert (
        scalar(
            "select found_by_count from public.opportunities where job_id = %s::uuid",
            job_id,
        )
        == 1
    )
    assert stats(job_id) == (1, 0)


def test_many_urls_one_domain_domain_is_new_once(job_id: str) -> None:
    workers, per = 8, 25

    def work(i: int, c: Conn) -> list[Discovery]:
        return [
            discover(c, job_id, "busy.com", f"w{i}-{k}", "google", f"q-{i}") for k in range(per)
        ]

    results = [d for chunk in run_parallel(workers, work) for d in chunk]
    assert sum(d[1] for d in results) == workers * per
    assert sum(d[3] for d in results) == 1, "G11: one new unique domain, however many racers"
    assert scalar("select count(*) from public.job_domains where job_id = %s::uuid", job_id) == 1
    assert stats(job_id) == (workers * per, 0)


def test_shuffled_overlap_has_no_deadlock_and_exact_counts(job_id: str) -> None:
    """Each worker inserts the same URLs in a different order. Lock order must hold."""
    workers, urls = 6, 40

    def work(i: int, c: Conn) -> int:
        order = list(range(urls))
        random.Random(i).shuffle(order)
        return sum(
            discover(c, job_id, f"d{k % 5}.com", f"u{k}", "google", f"q-{i}")[1] for k in order
        )

    created = run_parallel(workers, work)
    assert sum(created) == urls
    assert stats(job_id) == (urls, urls * (workers - 1))
    assert (
        scalar(
            "select count(*) from public.opportunities where job_id = %s::uuid"
            " and found_by_count = %s",
            job_id,
            workers,
        )
        == urls
    )
    assert scalar("select count(*) from public.job_domains where job_id = %s::uuid", job_id) == 5


def test_crossing_merges_leave_exactly_one_canonical_row(job_id: str) -> None:
    """a's final URL is b and b's final URL is a, at the same moment."""
    with psycopg.connect(WORKER_URL) as c:
        a = discover(c, job_id, "loop.com", "a", "google", "q-a")[0]
        b = discover(c, job_id, "loop.com", "b", "google", "q-b")[0]

    def work(i: int, c: Conn) -> tuple[str, uuid.UUID]:
        if i == 0:
            return merge(c, a, "https://loop.com/b")
        return merge(c, b, "https://loop.com/a")

    outcomes = run_parallel(2, work)
    assert sorted(o[0] for o in outcomes) in (
        ["merged", "unchanged"],
        ["already_merged", "merged"],
    )

    canonical = scalar(
        "select count(*) from public.opportunities where job_id = %s::uuid"
        " and duplicate_of is null",
        job_id,
    )
    assert canonical == 1
    assert scalar("select count(*) from public.opportunities where job_id = %s::uuid", job_id) == 2
    assert stats(job_id) == (1, 1)
    assert (
        scalar(
            "select count(*) from public.opportunities where job_id = %s::uuid"
            " and check_status = 'skipped' and check_reason is null",
            job_id,
        )
        == 0
    )


def test_discovery_racing_a_merge_loses_nothing(job_id: str) -> None:
    """One worker merges a into b while others keep discovering a's URL."""
    with psycopg.connect(WORKER_URL) as c:
        a = discover(c, job_id, "mix.com", "a", "google", "q-a")[0]
        discover(c, job_id, "mix.com", "b", "google", "q-b")

    n = 6

    def work(i: int, c: Conn) -> str:
        if i == 0:
            return merge(c, a, "https://mix.com/b")[0]
        discover(c, job_id, "mix.com", "a", "seed_list", f"list-{i}")
        return "discovered"

    run_parallel(n, work)

    # Every source ever reported ends up on the canonical row, wherever it landed.
    canonical = scalar(
        "select id from public.opportunities where job_id = %s::uuid and duplicate_of is null",
        job_id,
    )
    sources = scalar(
        "select count(distinct (s.source_type, s.source_ref))"
        " from public.opportunity_sources s"
        " where s.opportunity_id = %s",
        canonical,
    )
    # q-a, q-b, and list-1..list-(n-1)
    assert sources == 2 + (n - 1)
    uniq, _dups = stats(job_id)
    assert uniq == 1
