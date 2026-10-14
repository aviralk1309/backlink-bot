"""M3-S8: job_stats stays exact under a concurrent pipeline.

Phases, each with several worker connections racing:
  1. discovery   every worker finds the same URLs in a different order
  2. merges      disjoint pairs, plus one crossing pair (a -> b while b -> a)
  3. claim       workers claim everything, then finish rows in mixed ways
  4. reap        rows left running fail at max attempts 1
Then job_stats must equal what the calls returned AND what the raw rows say.

The unchecked_count trigger is deferred to COMMIT and takes the job_stats row
lock last. A deadlock between it and record_discovery, merge or claim would
show here as a 40P01 error.

Same env vars and local stack as the other integration tests. Run with:
  uv run pytest -m integration
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

WORKERS = 4
URLS = 60
DOMAINS = 6


@pytest.fixture
def job_id() -> Iterator[str]:
    jid = str(uuid.uuid4())
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "insert into public.jobs (id, name, status)"
            " values (%s::uuid, 'M3-S8 counters test', 'running')",
            (jid,),
        )
    try:
        yield jid
    finally:
        # Also proves a job delete with counted rows does not trip the trigger.
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("delete from public.jobs where id = %s::uuid", (jid,))


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
        row = admin.execute(sql, params).fetchone()
    assert row is not None
    return row[0]


def url(k: int) -> str:
    return f"https://d{k % DOMAINS}.com/u{k}"


def discover_all(job: str) -> Callable[[int, Conn], tuple[int, int]]:
    def work(i: int, conn: Conn) -> tuple[int, int]:
        order = list(range(URLS))
        random.Random(i).shuffle(order)
        created = 0
        added_to_existing = 0
        for k in order:
            dom = f"d{k % DOMAINS}.com"
            row = conn.execute(
                "select created, source_added from public.record_discovery"
                "(%s::uuid, %s, %s, %s, %s, %s, %s)",
                (job, f"http://orig.{dom}/u{k}", url(k), dom, dom, "google", f"q-{i}"),
            ).fetchone()
            conn.commit()
            assert row is not None
            created += int(row[0])
            added_to_existing += int(row[1] and not row[0])
        return (created, added_to_existing)

    return work


def merge(conn: Conn, opp: uuid.UUID, final_url: str) -> str:
    """The caller contract: retry on 40001 (the merge target changed under the lock)."""
    for _ in range(5):
        try:
            row = conn.execute(
                "select outcome from public.merge_opportunity_after_fetch(%s::uuid, %s)",
                (opp, final_url),
            ).fetchone()
            conn.commit()
            assert row is not None
            return str(row[0])
        except errors.SerializationFailure:
            conn.rollback()
    raise AssertionError("merge kept failing with 40001")


def finish_rows(job: str) -> Callable[[int, Conn], tuple[int, int, int]]:
    """Claim until empty, then finish the claimed rows in mixed ways.

    Returns (skipped, unchecked_tier, left_running) for this worker.
    """

    def work(i: int, conn: Conn) -> tuple[int, int, int]:
        mine: list[uuid.UUID] = []
        while True:
            rows = conn.execute(
                "select id from public.claim_opportunity_checks(%s, 7, 60)", (f"cnt-{i}",)
            ).fetchall()
            conn.commit()
            if not rows:
                break
            mine.extend(r[0] for r in rows)

        done_plain = mine[0::4]
        skipped = mine[1::4]
        done_unchecked = mine[2::4]
        left_running = mine[3::4]

        conn.execute(
            "update public.opportunities set check_status = 'done',"
            " locked_by = null, lease_expires_at = null where id = any(%s::uuid[])",
            (done_plain,),
        )
        conn.execute(
            "update public.opportunities set check_status = 'skipped',"
            " check_reason = 'domain_cap', locked_by = null, lease_expires_at = null"
            " where id = any(%s::uuid[])",
            (skipped,),
        )
        conn.execute(
            "update public.opportunities set check_status = 'done', tier = 'unchecked',"
            " locked_by = null, lease_expires_at = null where id = any(%s::uuid[])",
            (done_unchecked,),
        )
        conn.commit()
        return (len(skipped), len(done_unchecked), len(left_running))

    return work


def test_counters_stay_exact_under_a_concurrent_pipeline(job_id: str) -> None:
    # -- 1. discovery ---------------------------------------------------------
    found = run_parallel(WORKERS, discover_all(job_id))
    created = sum(f[0] for f in found)
    added_to_existing = sum(f[1] for f in found)
    assert created == URLS, "exactly one worker creates each row"
    assert added_to_existing == URLS * (WORKERS - 1)

    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        ids = {
            r[0]: r[1]
            for r in admin.execute(
                "select normalized_url, id from public.opportunities where job_id = %s::uuid",
                (job_id,),
            ).fetchall()
        }
    assert len(ids) == URLS

    # -- 2. merges ------------------------------------------------------------
    # Crossing pair first, so two different workers start on it together.
    tasks: list[tuple[uuid.UUID, str]] = [
        (ids[url(40)], url(41)),
        (ids[url(41)], url(40)),
    ]
    tasks += [(ids[url(k)], url(k + 1)) for k in range(0, 40, 2)]

    def merge_work(i: int, conn: Conn) -> list[str]:
        return [merge(conn, opp, final) for opp, final in tasks[i::WORKERS]]

    outcomes = [o for chunk in run_parallel(WORKERS, merge_work) for o in chunk]
    merged = outcomes.count("merged")
    assert merged == 20 + 1, "20 disjoint pairs and exactly one side of the crossing pair"

    # -- 3. claim and finish --------------------------------------------------
    results = run_parallel(WORKERS, finish_rows(job_id))
    skipped = sum(r[0] for r in results)
    unchecked_tier = sum(r[1] for r in results)
    left_running = sum(r[2] for r in results)
    assert skipped + unchecked_tier + left_running > 0

    # -- 4. reap: rows left running fail at max attempts 1 --------------------
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(
            "update public.opportunities set lease_expires_at = now() - interval '1 second'"
            " where job_id = %s::uuid and check_status = 'running'",
            (job_id,),
        )
    with psycopg.connect(WORKER_URL) as conn:
        reaped = conn.execute("select * from public.reap_expired_leases(1, 5000)").fetchone()
        conn.commit()
    assert reaped is not None
    requeued, failed = reaped
    assert requeued == 0
    assert failed >= left_running  # other leftover rows in a shared dev DB may add to it

    # -- the numbers ----------------------------------------------------------
    # Merged rows were skipped by the merge, not by us: they are not unchecked.
    expected_unique = created - merged
    expected_duplicates = added_to_existing + merged
    expected_unchecked = skipped + unchecked_tier + left_running

    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        stats = admin.execute(
            "select unique_opportunities, duplicates_skipped, unchecked_count"
            " from public.job_stats where job_id = %s::uuid",
            (job_id,),
        ).fetchone()
        recount = admin.execute(
            "select unique_opportunities, unchecked_count from public.job_stats_recount(%s::uuid)",
            (job_id,),
        ).fetchone()
        raw_total = admin.execute(
            "select count(*) from public.opportunities where job_id = %s::uuid", (job_id,)
        ).fetchone()
        raw_unchecked = admin.execute(
            "select count(*) from public.opportunities where job_id = %s::uuid"
            " and duplicate_of is null"
            " and (check_status in ('skipped', 'failed') or tier = 'unchecked')",
            (job_id,),
        ).fetchone()
    assert stats is not None and recount is not None
    assert raw_total is not None and raw_unchecked is not None

    assert raw_total[0] == URLS, "nothing is ever deleted (I3)"
    assert stats[0] == expected_unique == recount[0], "unique_opportunities"
    assert stats[1] == expected_duplicates, "duplicates_skipped"
    assert stats[2] == expected_unchecked == recount[1] == raw_unchecked[0], "unchecked_count"
