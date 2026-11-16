import os
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from worker.checks.framework import CheckRecord, CheckResult, CheckRun
from worker.checks.store import LostCheckClaim, save_check_run
from worker.db.pool import open_pool
from worker.engine.claims import ClaimedRow

pytestmark = pytest.mark.integration
WORKER_URL = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


@pytest.fixture
def claim():
    job, opportunity = uuid.uuid4(), uuid.uuid4()
    expires = datetime.now(UTC) + timedelta(minutes=5)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "insert into public.jobs(id, name, status) values (%s, 'S3 test', 'running')", (job,)
        )
        conn.execute(
            """insert into public.opportunities
            (id, job_id, original_url, normalized_url, host, domain, first_source_type,
             config_version, check_status, locked_by, attempts, lease_expires_at)
            values (%s,%s,'https://example.com','https://example.com','example.com','example.com',
                    'google',1,'running','s3-worker',2,%s)""",
            (opportunity, job, expires),
        )
    yield ClaimedRow(
        opportunity,
        job,
        "https://example.com",
        "https://example.com",
        "example.com",
        "example.com",
        None,
        2,
        1,
        2,
        expires,
    )
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("delete from public.jobs where id = %s", (job,))


def run(*keys):
    return CheckRun(
        1,
        tuple(CheckRecord(key, CheckResult("pass", "passed", "detail", {"n": 1})) for key in keys),
    )


def rows(claim):
    with psycopg.connect(ADMIN_URL) as conn:
        return conn.execute(
            "select check_key, status, reason_code, detail, evidence, config_version, checked_at "
            "from public.opportunity_checks where opportunity_id = %s order by check_key",
            (claim.id,),
        ).fetchall()


async def test_roundtrip_replacement_and_idempotency(claim):
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            await save_check_run(conn, claim, "s3-worker", run("a", "b"))
        stored = rows(claim)
        assert len(stored) == 2
        assert stored[0][1:6] == ("pass", "passed", "detail", {"n": 1}, 1)
        assert stored[0][6] == stored[1][6]
        async with pool.connection() as conn:
            await save_check_run(conn, claim, "s3-worker", run("a"))
            await save_check_run(conn, claim, "s3-worker", run("a"))
        assert len(rows(claim)) == 1
        async with pool.connection() as conn:
            state = await conn.execute(
                "select check_status from public.opportunities where id=%s", (claim.id,)
            )
            assert (await state.fetchone())[0] == "running"


@pytest.mark.parametrize("change", ["owner", "attempt", "expired", "config", "done"])
async def test_stale_claim_cannot_overwrite(claim, change):
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            await save_check_run(conn, claim, "s3-worker", run("original"))
        updates = {
            "owner": "locked_by = 'another-worker'",
            "attempt": "attempts = 3",
            "expired": "lease_expires_at = now() - interval '1 second'",
            "config": "config_version = 2",
            "done": "check_status = 'done'",
        }
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute(
                "update public.opportunities set " + updates[change] + " where id=%s", (claim.id,)
            )
        with pytest.raises(LostCheckClaim):
            async with pool.connection() as conn:
                await save_check_run(conn, claim, "s3-worker", run("stale"))
        assert rows(claim)[0][0] == "original"


async def test_invalid_batch_rolls_back_previous_snapshot(claim):
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            await save_check_run(conn, claim, "s3-worker", run("original"))
        with pytest.raises(psycopg.errors.UniqueViolation):
            async with pool.connection() as conn:
                await save_check_run(conn, claim, "s3-worker", run("duplicate", "duplicate"))
        assert rows(claim)[0][0] == "original"
        with pytest.raises(ValueError):
            async with pool.connection() as conn:
                await save_check_run(conn, replace(claim, config_version=2), "s3-worker", run("x"))


async def test_caller_transaction_can_rollback_checks_with_downstream_work(claim):
    async with open_pool(WORKER_URL) as pool:
        with pytest.raises(RuntimeError):
            async with pool.connection() as conn:
                await save_check_run(conn, claim, "s3-worker", run("a"))
                raise RuntimeError("later scoring failed")
        assert rows(claim) == []


async def test_s4_default_checks_persist_as_one_snapshot(claim):
    from worker.checks.catalog import default_registry
    from worker.checks.framework import CheckContext
    from worker.fetch.types import FetchResult

    context = CheckContext(
        FetchResult(
            "https://example.com",
            "https://example.com",
            "ok",
            status_code=200,
            text=(
                "<html><head><title>Garden guides</title></head>"
                "<body>Gardening advice</body></html>"
            ),
        ),
        1,
        {"seed_keywords": ["garden"], "language": "en"},
        robots_txt="",
    )
    results = await default_registry().run(context)
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            await save_check_run(conn, claim, "s3-worker", results)
    stored = rows(claim)
    assert {row[0] for row in stored} == {
        "page_loads",
        "indexable",
        "language",
        "region",
        "relevance",
        "spam_signals",
        "activity_fit",
        "linkability",
        "banned_category",
    }
    assert next(row for row in stored if row[0] == "language")[1] == "could_not_check"
    assert len({row[6] for row in stored}) == 1


@pytest.mark.parametrize(
    "key,reason",
    [
        ("page_loads", "page_gone"),
        ("indexable", "meta_noindex"),
        ("language", "language_mismatch"),
        ("banned_category", "banned_category_match"),
    ],
)
async def test_s6_publishes_filter_and_evidence_without_deleting(claim, key, reason):
    from worker.checks.auto_filter import publish_checks_and_filter

    checks = CheckRun(
        1,
        (
            CheckRecord(
                key,
                CheckResult(
                    "fail",
                    reason,
                    evidence={
                        "confidence": 0.99,
                        "margin": 0.9,
                        "target": "en",
                        "detected": "fr",
                        "letters": 300,
                    },
                ),
            ),
        ),
    )
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            decision = await publish_checks_and_filter(conn, claim, "s3-worker", checks)
        with psycopg.connect(ADMIN_URL) as admin:
            row = admin.execute(
                "select queue_group,filter_reason,filter_detail,check_status,locked_by,score,tier "
                "from public.opportunities where id=%s",
                (claim.id,),
            ).fetchone()
        assert row == ("auto_filtered", reason, decision.detail, "done", None, None, None)
        assert rows(claim)[0][2] == reason
        # Terminal publication cannot be replayed by a stale handler.
        with pytest.raises(LostCheckClaim):
            async with pool.connection() as conn:
                await publish_checks_and_filter(conn, claim, "s3-worker", checks)


async def test_s6_nonfilter_keeps_claim_for_scoring(claim):
    from worker.checks.auto_filter import publish_checks_and_filter

    checks = CheckRun(1, (CheckRecord("spam_signals", CheckResult("fail", "spam_keywords")),))
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            assert await publish_checks_and_filter(conn, claim, "s3-worker", checks) is None
    with psycopg.connect(ADMIN_URL) as admin:
        row = admin.execute(
            "select check_status,locked_by,queue_group,filter_reason,filter_detail "
            "from public.opportunities where id=%s",
            (claim.id,),
        ).fetchone()
    assert row == ("running", "s3-worker", None, None, None)
    assert rows(claim)[0][2] == "spam_keywords"


async def test_s6_stale_attempt_and_outer_rollback_preserve_state(claim):
    from worker.checks.auto_filter import publish_checks_and_filter

    checks = CheckRun(1, (CheckRecord("page_loads", CheckResult("fail", "page_gone")),))
    async with open_pool(WORKER_URL) as pool:
        with pytest.raises(LostCheckClaim):
            async with pool.connection() as conn:
                await publish_checks_and_filter(
                    conn, replace(claim, attempts=1), "s3-worker", checks
                )
        assert rows(claim) == []
        with pytest.raises(RuntimeError):
            async with pool.connection() as conn:
                await publish_checks_and_filter(conn, claim, "s3-worker", checks)
                raise RuntimeError("later transaction work failed")
        assert rows(claim) == []
    with psycopg.connect(ADMIN_URL) as admin:
        assert (
            admin.execute(
                "select queue_group from public.opportunities where id=%s", (claim.id,)
            ).fetchone()[0]
            is None
        )


async def test_s7_score_publication_is_claim_fenced_and_preserves_checks(claim):
    from worker.scoring.config import DEFAULT_CONFIG, ScoringSnapshot
    from worker.scoring.engine import Opportunity, SourceSignals, score
    from worker.scoring.store import save_score

    checks = run("page_loads", "language", "relevance")
    result = score(
        Opportunity(config_version=1),
        checks,
        SourceSignals(),
        ScoringSnapshot(policy=DEFAULT_CONFIG),
    )
    async with open_pool(WORKER_URL) as pool:
        async with pool.connection() as conn:
            await save_check_run(conn, claim, "s3-worker", checks)
            await save_score(conn, claim, "s3-worker", result)
        before = rows(claim)
        with pytest.raises(LostCheckClaim):
            async with pool.connection() as conn:
                await save_score(conn, replace(claim, attempts=1), "s3-worker", result)
        assert rows(claim) == before
        with psycopg.connect(ADMIN_URL) as admin:
            stored = admin.execute(
                "select score,tier,score_breakdown,check_status,locked_by "
                "from public.opportunities where id=%s",
                (claim.id,),
            ).fetchone()
        assert stored == (result.score, result.tier, result.breakdown, "running", "s3-worker")


async def test_s7_checks_and_score_share_outer_transaction(claim):
    from worker.scoring.config import DEFAULT_CONFIG, ScoringSnapshot
    from worker.scoring.engine import Opportunity, SourceSignals, score
    from worker.scoring.store import save_score

    checks = run("page_loads")
    result = score(
        Opportunity(config_version=1),
        checks,
        SourceSignals(),
        ScoringSnapshot(policy=DEFAULT_CONFIG),
    )
    async with open_pool(WORKER_URL) as pool:
        with pytest.raises(RuntimeError):
            async with pool.connection() as conn:
                await save_check_run(conn, claim, "s3-worker", checks)
                await save_score(conn, claim, "s3-worker", result)
                raise RuntimeError("Queue stage failed")
    assert rows(claim) == []
    with psycopg.connect(ADMIN_URL) as admin:
        assert admin.execute(
            "select score from public.opportunities where id=%s", (claim.id,)
        ).fetchone() == (None,)
