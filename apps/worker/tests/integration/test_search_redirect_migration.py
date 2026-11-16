"""Historical search redirects remain auditable after reclassification."""

import os
import uuid
from pathlib import Path

import psycopg
import pytest

pytestmark = pytest.mark.integration
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
MIGRATION = (
    Path(__file__).resolve().parents[4]
    / "supabase/migrations/20261031060000_m9_filter_search_redirects.sql"
)


def test_historical_redirect_is_filtered_without_losing_original_or_checks() -> None:
    job_id = uuid.uuid4()
    original = "https://google.com/goto?url=CAESabc"
    with psycopg.connect(ADMIN_URL) as admin:
        admin.execute(
            "insert into public.jobs(id,name,status) values(%s,'Redirect history','running')",
            (job_id,),
        )
        opportunity_id = admin.execute(
            "select opp_id from public.record_discovery(%s,%s,%s,%s,%s,'google',%s)",
            (job_id, original, original, "google.com", "google.com", "legacy-query"),
        ).fetchone()[0]
        admin.execute(
            "update public.opportunities set queue_group='ready' where id=%s", (opportunity_id,)
        )
        admin.execute(MIGRATION.read_text(encoding="utf-8"))
        first = admin.execute(
            "select original_url,queue_group,check_status,filter_reason,"
            "extras->'search_redirect_previous_state' from public.opportunities where id=%s",
            (opportunity_id,),
        ).fetchone()
        assert first[:4] == (original, "auto_filtered", "skipped", "search_redirect")
        assert first[4]["queue_group"] == "ready"
        assert first[4]["check_status"] == "pending"
        assert admin.execute(
            "select count(*) from public.opportunity_sources where opportunity_id=%s",
            (opportunity_id,),
        ).fetchone() == (1,)
        admin.execute(MIGRATION.read_text(encoding="utf-8"))
        assert (
            admin.execute(
                "select extras->'search_redirect_previous_state' "
                "from public.opportunities where id=%s",
                (opportunity_id,),
            ).fetchone()[0]
            == first[4]
        )
        admin.rollback()
