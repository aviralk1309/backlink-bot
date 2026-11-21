"""AR-04: the local Storage service enforces the advertised 100 MiB CSV limit."""

import asyncio
import os
import subprocess
import uuid
from pathlib import Path

import httpx
import pytest

from worker.io.storage import StorageClient

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[4]
LIMIT = 100 * 1024 * 1024


async def test_local_storage_accepts_below_and_rejects_above_csv_limit(tmp_path: Path) -> None:
    result = await asyncio.to_thread(
        subprocess.run,
        [
            "supabase",
            "--workdir",
            os.environ.get("TEST_SUPABASE_WORKDIR", str(ROOT)),
            "status",
            "--output",
            "env",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    status = {
        key: value.strip('"')
        for line in result.stdout.splitlines()
        if "=" in line
        for key, value in [line.split("=", 1)]
    }
    storage = StorageClient(status["API_URL"], status["SERVICE_ROLE_KEY"])
    job_id = uuid.uuid4()
    paths = [f"{job_id}/{uuid.uuid4()}.csv" for _ in range(2)]
    below, above = tmp_path / "below.csv", tmp_path / "above.csv"
    for file, size in ((below, LIMIT - 1), (above, LIMIT + 1)):
        with file.open("wb") as stream:
            stream.write(b"URL\n")
            stream.truncate(size)

    try:
        await storage.upload_file("csv-uploads", paths[0], below)
        with pytest.raises(httpx.HTTPStatusError) as rejected:
            await storage.upload_file("csv-uploads", paths[1], above)
        assert rejected.value.response.status_code in (400, 413)
        assert any(
            word in rejected.value.response.text.lower() for word in ("size", "large", "exceed")
        )
    finally:
        for path in paths:
            await storage.delete_file(path)
