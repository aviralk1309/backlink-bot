import asyncio
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from worker.db.pool import open_pool
from worker.scoring.config import DEFAULT_CONFIG
from worker.scoring.rescore import rescore_next

pytestmark = pytest.mark.integration
ADMIN = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
WORKER = os.environ.get(
    "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
)


@pytest.fixture
def data():
    job, user, role = uuid4(), uuid4(), uuid4()
    ids = sorted(uuid4() for _ in range(4))
    profile = "s7_" + uuid4().hex
    with psycopg.connect(ADMIN) as conn:
        conn.execute("insert into public.roles(id,name) values(%s,%s)", (role, f"S7 {role}"))
        conn.execute(
            "insert into public.role_permissions(role_id,permission_key) "
            "values(%s,'jobs.view'),(%s,'jobs.rescore')",
            (role, role),
        )
        conn.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"{user}@s7.test"))
        conn.execute(
            "update public.profiles set role_id=%s,status='active' where id=%s", (role, user)
        )
        conn.execute(
            "insert into public.activity_profiles(key,name,scoring_weights) values(%s,'S7',%s)",
            (profile, Jsonb(DEFAULT_CONFIG.weights.model_dump())),
        )
        conn.execute(
            "insert into public.jobs(id,name,status,activity_keys) values(%s,'S7','completed',%s)",
            (job, [profile]),
        )
        for n, oid in enumerate(ids):
            conn.execute(
                """insert into public.opportunities(id,job_id,original_url,normalized_url,
              host,domain,
              first_source_type,config_version,check_status,queue_group,score,tier,activity_key,overlap_count)
              values(%s,%s,%s,%s,'s7.example','s7.example','competitor_csv',1,'done','backlog',1,'low',%s,2)""",
                (oid, job, f"https://s7.example/{n}", f"https://s7.example/{n}", profile),
            )
            for key, evidence in (
                ("page_loads", {}),
                ("language", {}),
                ("region", {}),
                ("relevance", {"score": 0.8}),
                ("activity_fit", {"score": 0.5}),
            ):
                conn.execute(
                    """insert into public.opportunity_checks(opportunity_id,check_key,status,
                  reason_code,evidence,config_version)
                  values(%s,%s,'pass',%s,%s,1)""",
                    (oid, key, "region_disabled" if key == "region" else "passed", Jsonb(evidence)),
                )
            for source, ref in (
                ("google", "q1"),
                ("google", "q2"),
                ("google", "q3"),
                ("seed_list", "seed"),
            ):
                conn.execute(
                    "insert into "
                    "public.opportunity_sources(opportunity_id,source_type,source_ref) "
                    "values(%s,%s,%s)",
                    (oid, source, ref),
                )
        conn.execute(
            "update public.opportunities set "
            "queue_group='auto_filtered',filter_reason='blocklisted' where id=%s",
            (ids[1],),
        )
        conn.execute(
            "update public.opportunities set duplicate_of=%s where id=%s", (ids[0], ids[2])
        )
        conn.execute(
            "update public.opportunities set "
            "check_status='skipped',check_reason='domain_cap',tier='unchecked' where id=%s",
            (ids[3],),
        )
    yield job, user, ids, profile
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute("delete from public.jobs where id=%s", (job,))
        conn.execute("delete from auth.users where id=%s", (user,))
        conn.execute("delete from public.roles where id=%s", (role,))
        conn.execute("delete from public.activity_profiles where key=%s", (profile,))


def request(data, confirmed=True):
    with psycopg.connect(ADMIN) as conn:
        conn.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(data[1]),))
        conn.execute("set local role authenticated")
        return conn.execute(
            "select public.request_job_rescore(%s,%s)", (data[0], confirmed)
        ).fetchone()[0]


def snapshot(data):
    with psycopg.connect(ADMIN) as conn:
        opportunities = conn.execute(
            "select to_jsonb(o) from public.opportunities o where job_id=%s order by id", (data[0],)
        ).fetchall()
        checks = conn.execute(
            "select to_jsonb(c) from public.opportunity_checks c join public.opportunities "
            "o on o.id=c.opportunity_id where o.job_id=%s order by c.opportunity_id,c.check_key",
            (data[0],),
        ).fetchall()
        return opportunities, checks


async def test_rescore_changes_only_scores_and_keeps_captured_policy(data):
    before, raw = snapshot(data)
    req = request(data)
    assert request(data) == req
    with psycopg.connect(ADMIN) as conn:
        captured = conn.execute(
            "select scoring_snapshot from public.job_rescore_requests where id=%s", (req,)
        ).fetchone()[0]
        assert captured["policy"] == DEFAULT_CONFIG.model_dump(mode="json")
        conn.execute(
            "update public.activity_profiles set scoring_weights=%s where key=%s",
            (
                Jsonb(
                    {
                        "relevance": 50,
                        "language_region": 10,
                        "activity_fit": 20,
                        "overlap": 10,
                        "multi_query": 10,
                        "spam_penalty": 30,
                    }
                ),
                data[3],
            ),
        )
    # Committed live weights changed; the request must still use the captured weights.
    assert snapshot(data)[0] == before
    async with open_pool(WORKER) as pool:
        assert await rescore_next(pool) == req
        assert await rescore_next(pool) is None
    after, raw_after = snapshot(data)
    assert raw_after == raw
    for (old,), (new,) in zip(before, after, strict=True):
        if old["id"] in (str(data[2][1]), str(data[2][2])):
            assert old == new
        else:
            assert new["score"] == 65.5
            assert new["tier"] == ("unchecked" if old["check_reason"] == "domain_cap" else "medium")
            for key in ("score", "tier", "score_breakdown", "updated_at"):
                old.pop(key)
                new.pop(key)
            assert old == new
    with psycopg.connect(ADMIN) as conn:
        assert conn.execute(
            "select status,scored_count from public.job_rescore_requests where id=%s", (req,)
        ).fetchone() == ("done", 2)

    # Another explicit request adopts the new profile version; nothing did so automatically.
    newer = request(data)
    async with open_pool(WORKER) as pool:
        assert await rescore_next(pool) == newer
    latest, _ = snapshot(data)
    assert latest[0][0]["score"] == 70
    assert latest[0][0]["score_breakdown"]["activity_profile_version"] == 2


async def test_three_google_queries_outscore_one_with_identical_checks(data):
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(
            "update public.opportunities set check_status='done',check_reason=null where id=%s",
            (data[2][3],),
        )
        conn.execute(
            "delete from public.opportunity_sources where opportunity_id=%s "
            "and source_type='google' and source_ref in ('q2','q3')",
            (data[2][3],),
        )
    req = request(data)
    async with open_pool(WORKER) as pool:
        assert await rescore_next(pool) == req
    with psycopg.connect(ADMIN) as conn:
        three, one = conn.execute(
            "select score from public.opportunities where id=any(%s) order by id",
            ([data[2][0], data[2][3]],),
        ).fetchall()
    assert three[0] - one[0] == 7.5


async def test_invalid_data_rolls_back_all_rows(data):
    before, _ = snapshot(data)
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(
            "update public.opportunity_checks set config_version=2 where opportunity_id=%s",
            (data[2][3],),
        )
    req = request(data)
    async with open_pool(WORKER) as pool:
        assert await rescore_next(pool) == req
    assert snapshot(data)[0] == before
    with psycopg.connect(ADMIN) as conn:
        assert conn.execute(
            "select status,scored_count from public.job_rescore_requests where id=%s", (req,)
        ).fetchone() == ("failed", 0)


async def test_competing_workers_process_once_and_rollback_retries(data):
    req = request(data)
    async with open_pool(WORKER) as pool:
        async with pool.connection() as conn:
            await conn.execute("select * from public.worker_next_rescore()")
            assert await rescore_next(pool) is None
            await conn.rollback()
        results = await asyncio.gather(rescore_next(pool), rescore_next(pool))
        assert results.count(req) == 1 and results.count(None) == 1


def test_confirmation_permission_and_idle_guards(data):
    with pytest.raises(psycopg.errors.InvalidParameterValue):
        request(data, False)
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(
            "update public.opportunities set "
            "check_status='running',locked_by='s7',lease_expires_at=now()+interval '1 "
            "hour' where id=%s",
            (data[2][0],),
        )
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
        request(data)
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute("update public.profiles set status='rejected' where id=%s", (data[1],))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        request(data)
