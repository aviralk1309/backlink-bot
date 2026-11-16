"""Local browser-test driver using real worker code and real Supabase Storage.

No fabricated staging rows, status updates, network crawling or paid discovery.
Run only with an otherwise idle local queue.
"""

import argparse
import asyncio
import os
import uuid
from urllib.parse import urlsplit

from worker.config.settings import Settings
from worker.db.pool import open_pool
from worker.engine.csv_runner import CsvRunner
from worker.engine.runner import pick_up_next_job


async def main(phase: str, job_id: uuid.UUID) -> None:
    database_url = os.environ.get(
        "E2E_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
    )
    storage_url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    for url in (database_url, storage_url):
        if urlsplit(url).hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("E2E ingestion requires local services")
    if urlsplit(database_url).username != "worker":
        raise ValueError("E2E ingestion must use the worker database role")
    settings = Settings(
        database_url=database_url,
        supabase_url=storage_url,
        supabase_service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        _env_file=None,
    )
    async with open_pool(database_url) as pool:
        async with pool.connection() as conn:
            row = await (
                await conn.execute("select name from public.jobs where id = %s", (job_id,))
            ).fetchone()
            expected_name = "E2E review job " if phase == "review" else "E2E mapping job "
            if not row or not row[0].startswith(expected_name):
                raise ValueError("Only browser-test jobs may be processed")
            if phase != "review":
                query = (
                    "select job_id from public.csv_uploads where status = 'mapped' and job_id <> %s"
                    if phase == "csv"
                    else "select id from public.jobs where status = 'queued' and id <> %s"
                )
                if await (await conn.execute(query, (job_id,))).fetchone():
                    raise ValueError("Use an idle local queue; another job is eligible")
        if phase == "csv":
            runner = CsvRunner(pool, settings, asyncio.Event(), max_pickups_per_tick=1)
            assert await runner.tick() == 1, "No mapped upload was processed"
            async with pool.connection() as conn:
                row = await (
                    await conn.execute(
                        "select status::text, status_reason from public.csv_uploads "
                        "where job_id = %s",
                        (job_id,),
                    )
                ).fetchone()
                assert row and row[0] == "ready", row
        elif phase == "job":
            assert await pick_up_next_job(pool) == (job_id, "running")
        else:
            async with pool.connection() as conn, conn.transaction():
                rows = await (
                    await conn.execute(
                        "select id from public.opportunities where job_id=%s "
                        "and check_status='running' and locked_by='e2e-review' order by id",
                        (job_id,),
                    )
                ).fetchall()
                if len(rows) != 2:
                    raise ValueError("Expected two leased review fixtures")
                checks = (
                    '[{"check_key":"page","status":"pass",'
                    '"reason_code":"ok","detail":"","evidence":{}}]'
                )
                for (opportunity_id,) in rows:
                    saved = await (
                        await conn.execute(
                            "select public.worker_save_opportunity_checks(%s,%s,1,1,%s::jsonb)",
                            (opportunity_id, "e2e-review", checks),
                        )
                    ).fetchone()
                    if saved != (True,):
                        raise ValueError("Could not save review fixture checks")
                    assigned = await (
                        await conn.execute(
                            "select public.worker_assign_opportunity_queue(%s,%s,1,1)",
                            (opportunity_id, "e2e-review"),
                        )
                    ).fetchone()
                    if assigned != ("ready",):
                        raise ValueError("Could not assign review fixture to Ready")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["csv", "job", "review"])
    parser.add_argument("job_id", type=uuid.UUID)
    args = parser.parse_args()
    asyncio.run(main(args.phase, args.job_id))
