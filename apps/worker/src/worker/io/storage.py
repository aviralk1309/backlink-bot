"""Bounded-memory Storage downloads and error-report uploads."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path

import httpx

CHUNK_SIZE = 64 * 1024


async def _file_chunks(path: Path) -> AsyncGenerator[bytes]:
    with path.open("rb") as source:
        while chunk := source.read(CHUNK_SIZE):
            yield chunk


class StorageClient:
    def __init__(self, base_url: str, service_role_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.key = service_role_key

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}", "apikey": self.key}

    async def delete_job_files(self, job_id: str) -> None:
        """Remove every object in a deleted job's flat CSV folder, in bounded batches."""
        base = f"{self.base_url}/storage/v1/object"
        async with httpx.AsyncClient(timeout=60.0) as client:
            while True:
                listed = await client.post(
                    f"{base}/list/csv-uploads",
                    headers=self._headers(),
                    json={"prefix": job_id, "limit": 1000, "offset": 0},
                )
                listed.raise_for_status()
                files = listed.json()
                if not files:
                    return
                if any(not item.get("id") for item in files):
                    raise ValueError(f"Unexpected nested Storage path under {job_id}")
                removed = await client.request(
                    "DELETE",
                    f"{base}/csv-uploads",
                    headers=self._headers(),
                    json={"prefixes": [f"{job_id}/{item['name']}" for item in files]},
                )
                removed.raise_for_status()

    async def download_file(self, bucket: str, path: str, dest_path: Path) -> None:
        url = f"{self.base_url}/storage/v1/object/{bucket}/{path.lstrip('/')}"
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", url, headers=self._headers(), timeout=60.0) as resp:
                resp.raise_for_status()
                with dest_path.open("wb") as dest:
                    async for chunk in resp.aiter_bytes(CHUNK_SIZE):
                        dest.write(chunk)

    async def upload_file(
        self, bucket: str, path: str, content: bytes | Path, content_type: str = "text/csv"
    ) -> None:
        url = f"{self.base_url}/storage/v1/object/{bucket}/{path.lstrip('/')}"
        headers = self._headers()
        headers["Content-Type"] = content_type
        headers["Content-Length"] = str(
            (await asyncio.to_thread(content.stat)).st_size
            if isinstance(content, Path)
            else len(content)
        )
        async with httpx.AsyncClient() as client:
            # Reopen the file for an upsert retry; never reuse an exhausted stream.
            for attempt in range(2):
                body = _file_chunks(content) if isinstance(content, Path) else content
                try:
                    resp = await client.post(url, headers=headers, content=body, timeout=60.0)
                finally:
                    if not isinstance(body, bytes):
                        await body.aclose()
                is_dup = resp.status_code == 400 and (
                    "Duplicate" in resp.text or "already exists" in resp.text
                )
                if attempt == 0 and is_dup:
                    headers["x-upsert"] = "true"
                    continue
                resp.raise_for_status()
                return
