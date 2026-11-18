from contextlib import asynccontextmanager

import httpx
import pytest
import respx

from worker.io import storage
from worker.io.storage import CHUNK_SIZE, StorageClient

pytestmark = pytest.mark.unit


async def test_storage_streams_download_and_reopens_upload_on_duplicate(tmp_path, monkeypatch):
    payload = b"x" * (CHUNK_SIZE * 3 + 17)
    attempts = []

    class Download(httpx.AsyncByteStream):
        async def __aiter__(self):
            for offset in range(0, len(payload), CHUNK_SIZE):
                yield payload[offset : offset + CHUNK_SIZE]

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        @asynccontextmanager
        async def stream(self, method, url, **kwargs):
            response = httpx.Response(200, request=httpx.Request(method, url), stream=Download())
            try:
                yield response
            finally:
                await response.aclose()

        async def post(self, url, *, content, headers, **kwargs):
            assert not isinstance(content, bytes)
            chunks = []
            async for chunk in content:
                assert len(chunk) <= CHUNK_SIZE
                chunks.append(chunk)
            assert b"".join(chunks) == payload
            assert int(headers["Content-Length"]) == len(payload)
            attempts.append(dict(headers))
            return httpx.Response(
                400 if len(attempts) == 1 else 200,
                text="Duplicate" if len(attempts) == 1 else "ok",
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(storage.httpx, "AsyncClient", Client)
    client = StorageClient("https://storage.example", "test-key")
    target = tmp_path / "report.csv"
    await client.download_file("csv-uploads", "test.csv", target)
    assert target.read_bytes() == payload
    await client.upload_file("csv-uploads", "errors.csv", target)
    assert len(attempts) == 2
    assert attempts[1]["x-upsert"] == "true"


@respx.mock
async def test_job_cleanup_lists_and_removes_all_files() -> None:
    job_id = "e2000000-0000-0000-0000-000000000001"
    listed = respx.post("https://storage.example/storage/v1/object/list/csv-uploads")
    listed.mock(
        side_effect=[
            httpx.Response(200, json=[{"id": "1", "name": "upload.csv"}]),
            httpx.Response(200, json=[]),
        ]
    )
    removed = respx.delete("https://storage.example/storage/v1/object/csv-uploads").mock(
        return_value=httpx.Response(200, json=[])
    )

    await StorageClient("https://storage.example", "test-key").delete_job_files(job_id)

    assert listed.call_count == 2
    assert removed.call_count == 1
    assert removed.calls[0].request.content == (
        b'{"prefixes":["e2000000-0000-0000-0000-000000000001/upload.csv"]}'
    )


@respx.mock
async def test_single_file_cleanup_uses_exact_storage_path() -> None:
    removed = respx.delete("https://storage.example/storage/v1/object/csv-uploads").mock(
        return_value=httpx.Response(200, json=[])
    )

    await StorageClient("https://storage.example", "test-key").delete_file("job/upload.csv")

    assert removed.call_count == 1
    assert removed.calls[0].request.content == b'{"prefixes":["job/upload.csv"]}'
