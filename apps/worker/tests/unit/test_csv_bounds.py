import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.io.csv_validator import CsvRowLimitError, validate_and_stage_csv

pytestmark = pytest.mark.unit


def connection():
    conn = MagicMock()
    conn.execute = AsyncMock()
    conn.cursor.return_value.__aenter__.return_value = AsyncMock()
    return conn


async def test_row_limit_counts_invalid_empty_and_duplicate_records(tmp_path):
    source = tmp_path / "input.csv"
    source.write_text("URL\nhttps://example.com/a\nhttps://example.com/a\n\nbad-url\n")
    with pytest.raises(CsvRowLimitError, match="row_limit_exceeded"):
        await validate_and_stage_csv(
            connection(), uuid.uuid4(), source, {"url_index": 0}, max_rows=3
        )


async def test_error_report_is_a_temporary_file_not_bytes(tmp_path):
    source = tmp_path / "input.csv"
    source.write_text("URL\nbad-url\n")
    report = None

    async def upload(key, path):
        nonlocal report
        report = path
        assert isinstance(path, Path)
        assert "bad_url" in path.read_text()

    stats, key = await validate_and_stage_csv(
        connection(),
        uuid.uuid4(),
        source,
        {"url_index": 0},
        storage_uploader=upload,
        job_id=uuid.uuid4(),
    )
    assert key is not None
    assert stats.invalid_rows == 1
    assert isinstance(report, Path)
    assert not report.exists()


async def test_cancelled_staging_cleans_scratch_files(tmp_path, monkeypatch):
    import asyncio

    from worker.io import csv_validator

    source = tmp_path / "input.csv"
    source.write_text("URL\nhttps://example.com/a\n")
    monkeypatch.setattr(csv_validator.tempfile, "tempdir", str(tmp_path))

    async def cancel(conn, rows):
        raise asyncio.CancelledError()

    monkeypatch.setattr(csv_validator, "flush_staged_rows", cancel)
    with pytest.raises(asyncio.CancelledError):
        await validate_and_stage_csv(connection(), uuid.uuid4(), source, {"url_index": 0})
    assert list(tmp_path.iterdir()) == [source]
