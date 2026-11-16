"""Explicit local-DB benchmark; run each size in a fresh process for comparable RSS.

uv run python scripts/benchmark_csv_memory.py --rows 250000 --kind unique
Storage is a chunked local fixture; validation and PostgreSQL staging are real.
"""

import argparse
import asyncio
import json
import os
import resource
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

import psycopg

from worker.config.settings import Settings
from worker.db.pool import open_pool
from worker.engine.csv_runner import CsvRunner
from worker.io.storage import _file_chunks


async def main(rows: int, kind: str) -> None:
    worker_url = os.environ.get(
        "TEST_WORKER_DATABASE_URL", "postgresql://worker:worker@127.0.0.1:54322/postgres"
    )
    admin_url = os.environ.get(
        "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    job, upload = uuid.uuid4(), uuid.uuid4()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source.csv"
        with source.open("w") as dest:
            dest.write("URL\n")
            for i in range(rows):
                prefix = "https://example.org/" if kind == "unique" else "ftp://example.org/"
                dest.write(prefix + str(i) + "/" + "x" * 200 + "\n")

        class Storage:
            report_bytes = 0

            async def download_file(self, bucket, path, target):
                shutil.copyfile(source, target)

            async def upload_file(self, bucket, path, content):
                async for chunk in _file_chunks(content):
                    self.report_bytes += len(chunk)

        storage = Storage()
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(
                "insert into public.jobs(id, name) values (%s, 'CSV memory benchmark')", (job,)
            )
            try:
                admin.execute(
                    "insert into public.csv_uploads"
                    " (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)"
                    " values (%s, %s, 'client', 'test.csv', %s, %s, 'mapped', '{\"url_index\":0}')",
                    (upload, job, f"{job}/{upload}.csv", source.stat().st_size),
                )
                start = time.monotonic()
                async with open_pool(worker_url) as pool:
                    runner = CsvRunner(
                        pool, Settings(database_url=worker_url, _env_file=None), asyncio.Event()
                    )
                    runner._storage = storage
                    claim = await runner._claim_next()
                    assert claim and claim["id"] == upload, "Run without other mapped uploads"
                    await runner._process_upload(claim)
                result = admin.execute(
                    "select status::text, total_rows, valid_rows, invalid_rows "
                    "from public.csv_uploads where id = %s",
                    (upload,),
                ).fetchone()
                assert result == (
                    "ready",
                    rows,
                    rows if kind == "unique" else 0,
                    rows if kind == "invalid" else 0,
                ), result
                count = admin.execute(
                    "select count(*) from public.csv_rows where upload_id = %s", (upload,)
                ).fetchone()[0]
                assert count == rows
                rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                mib = rss / (1024 * 1024 if sys.platform == "darwin" else 1024)
                print(
                    json.dumps(
                        {
                            "rows": rows,
                            "kind": kind,
                            "peak_rss_mib": round(mib, 2),
                            "elapsed_seconds": round(time.monotonic() - start, 2),
                            "report_bytes": storage.report_bytes,
                        }
                    ),
                    flush=True,
                )
            finally:
                admin.execute("delete from public.jobs where id = %s", (job,))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--kind", choices=["unique", "invalid"], required=True)
    args = parser.parse_args()
    asyncio.run(main(args.rows, args.kind))
