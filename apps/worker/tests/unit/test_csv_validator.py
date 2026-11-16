import asyncio
import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.io.csv_validator import (
    ValidationStats,
    classify_and_validate_row,
    validate_and_stage_csv,
)


@pytest.mark.unit
def test_validation_stats_check_counts() -> None:
    stats = ValidationStats(
        total_rows=10,
        valid_rows=7,
        invalid_rows=2,
        empty_rows=1,
        duplicate_rows=2,
    )
    assert stats.check_counts() is True

    bad_stats = ValidationStats(
        total_rows=10,
        valid_rows=5,
        invalid_rows=2,
        empty_rows=1,
    )
    assert bad_stats.check_counts() is False


@pytest.mark.unit
def test_classify_valid_url_and_duplicate() -> None:
    upload_id = uuid.uuid4()
    seen: set[str] = set()
    mapping = {"url_index": 0, "columns": []}

    cells = ("https://example.com/page1", "Some Text")
    staged, kind = classify_and_validate_row(upload_id, 1, cells, mapping, seen)
    assert kind == "valid"
    assert staged.is_valid is True
    assert staged.is_duplicate is False
    assert staged.error_code is None
    assert staged.normalized_url == "https://example.com/page1"
    assert staged.domain == "example.com"
    assert staged.host == "example.com"

    # Second row with the same normalized URL (internal duplicate)
    cells2 = ("https://example.com/page1?utm_source=twitter", "Another Text")
    staged2, kind2 = classify_and_validate_row(upload_id, 2, cells2, mapping, seen)
    assert kind2 == "valid"
    assert staged2.is_valid is True
    assert staged2.is_duplicate is True
    assert staged2.error_code is None
    assert staged2.normalized_url == "https://example.com/page1"


@pytest.mark.unit
def test_classify_empty_row() -> None:
    upload_id = uuid.uuid4()
    seen: set[str] = set()
    mapping = {"url_index": 0, "columns": []}

    cells = ("", "   ", "")
    staged, kind = classify_and_validate_row(upload_id, 1, cells, mapping, seen)
    assert kind == "empty"
    assert staged.is_valid is False
    assert staged.error_code == "empty_row"


@pytest.mark.unit
def test_classify_invalid_url_reasons() -> None:
    upload_id = uuid.uuid4()
    seen: set[str] = set()
    mapping = {"url_index": 0, "columns": []}

    # Non-http scheme
    cells_ftp = ("ftp://files.example.com/data.zip",)
    staged_ftp, kind_ftp = classify_and_validate_row(upload_id, 1, cells_ftp, mapping, seen)
    assert kind_ftp == "invalid"
    assert staged_ftp.is_valid is False
    assert staged_ftp.error_code == "not_http"

    # Bad host / malformed
    cells_bad = ("https://not_a_valid_domain/",)
    staged_bad, kind_bad = classify_and_validate_row(upload_id, 2, cells_bad, mapping, seen)
    assert kind_bad == "invalid"
    assert staged_bad.is_valid is False
    assert staged_bad.error_code == "bad_url"

    # Too long
    cells_long = ("https://example.com/" + "a" * 2500,)
    staged_long, kind_long = classify_and_validate_row(upload_id, 3, cells_long, mapping, seen)
    assert kind_long == "invalid"
    assert staged_long.is_valid is False
    assert staged_long.error_code == "too_long"


@pytest.mark.unit
def test_classify_extras_extraction() -> None:
    upload_id = uuid.uuid4()
    seen: set[str] = set()
    mapping = {
        "url_index": 0,
        "columns": [
            {"index": 1, "label": "Anchor Text", "type": "text"},
            {"index": 2, "label": "Domain Rating", "type": "number"},
            {"index": 3, "label": "Ignored Col", "type": "ignore"},
        ],
    }

    cells = ("https://sample.com/article", "best tools", "42", "unwanted data")
    staged, kind = classify_and_validate_row(upload_id, 1, cells, mapping, seen)
    assert kind == "valid"
    extras = json.loads(staged.extras)
    assert extras == {
        "Anchor Text": "best tools",
        "Domain Rating": 42,
    }


@pytest.mark.asyncio
async def test_validate_and_stage_csv_full_file(tmp_path: Path) -> None:
    csv_content = (
        "URL,Anchor,DR\n"
        "https://example.com/one,First,10\n"
        "https://example.com/one,Duplicate,10\n"
        ",Blank,\n"
        "bad-url,Wrong,20\n"
        "https://another.com/two,Second,30\n"
    )
    file_path = tmp_path / "test.csv"
    file_path.write_text(csv_content, encoding="utf-8")

    upload_id = uuid.uuid4()
    job_id = uuid.uuid4()
    mapping = {
        "url_index": 0,
        "columns": [
            {"index": 1, "label": "Anchor", "type": "text"},
            {"index": 2, "label": "DR", "type": "number"},
        ],
    }

    mock_conn = MagicMock()
    mock_cursor = AsyncMock()
    mock_conn.cursor.return_value.__aenter__.return_value = mock_cursor
    mock_conn.execute = AsyncMock()

    uploaded_files: dict[str, bytes] = {}

    async def mock_uploader(path: str, data: Path) -> None:
        uploaded_files[path] = await asyncio.to_thread(data.read_bytes)

    stats, error_path = await validate_and_stage_csv(
        conn=mock_conn,
        upload_id=upload_id,
        file_path=file_path,
        mapping=mapping,
        storage_uploader=mock_uploader,
        job_id=job_id,
    )

    assert stats.total_rows == 5
    assert stats.valid_rows == 3
    assert stats.duplicate_rows == 1
    assert stats.invalid_rows == 1
    assert stats.empty_rows == 1
    assert stats.check_counts() is True

    assert error_path == f"{job_id}/{upload_id}_errors.csv"
    assert error_path in uploaded_files
    error_csv = uploaded_files[error_path].decode("utf-8")
    assert "row_no,raw_url,error_reason" in error_csv
    assert "bad_url" in error_csv
    assert "empty_row" in error_csv
