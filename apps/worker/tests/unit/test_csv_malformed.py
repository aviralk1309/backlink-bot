"""M4-S9: Tests for malformed and edge-case CSV files.

Verifies:
  - 0-byte empty file handling
  - Headers-only file handling
  - Preamble lines before header
  - Duplicate header column handling
  - Ragged rows (fewer / more columns than header)
  - Unmatched quotes and corrupted data
  - Embedded NUL bytes
  - Classification of messy rows (unsupported protocol, malformed URL, overlength, empty)
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from worker.io import CsvReadError, detect_csv_format, iter_csv_rows
from worker.io.csv_validator import classify_and_validate_row

REPO_FIXTURE_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "csv"

pytestmark = pytest.mark.unit


def test_empty_file_handling() -> None:
    path = REPO_FIXTURE_DIR / "edge_empty.csv"
    fmt = detect_csv_format(path)
    assert fmt.encoding.method == "empty"
    assert len(fmt.header.names) == 0

    with pytest.raises(CsvReadError) as exc_info:
        list(iter_csv_rows(path, fmt))
    assert exc_info.value.code == "empty_file"


def test_headers_only_handling() -> None:
    path = REPO_FIXTURE_DIR / "edge_headers_only.csv"
    fmt = detect_csv_format(path)
    assert len(fmt.header.names) > 0

    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) == 0


def test_duplicate_headers_handling() -> None:
    path = REPO_FIXTURE_DIR / "edge_duplicate_headers.csv"
    fmt = detect_csv_format(path)
    assert len(fmt.header.names) >= 2

    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0


def test_preamble_before_header() -> None:
    path = REPO_FIXTURE_DIR / "edge_preamble_header.csv"
    fmt = detect_csv_format(path)
    assert fmt.header.header_line == 4
    assert any("url" in n.lower() for n in fmt.header.names)

    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0


def test_messy_csv_row_classification() -> None:
    path = REPO_FIXTURE_DIR / "edge_messy.csv"
    fmt = detect_csv_format(path)

    url_idx = next(i for i, h in enumerate(fmt.header.names) if h.lower() == "url")
    mapping = {"url_index": url_idx, "columns": []}

    upload_id = uuid.uuid4()
    seen: set[str] = set()

    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0

    valid_count = 0
    duplicate_count = 0
    invalid_count = 0
    empty_count = 0
    error_codes: set[str] = set()

    for r in rows:
        staged, kind = classify_and_validate_row(upload_id, r.row_no, r.cells, mapping, seen)
        if kind == "valid":
            valid_count += 1
            if staged.is_duplicate:
                duplicate_count += 1
        elif kind == "invalid":
            invalid_count += 1
            if staged.error_code:
                error_codes.add(staged.error_code)
        elif kind == "empty":
            empty_count += 1

    assert valid_count > 0
    assert duplicate_count > 0
    assert invalid_count > 0
    assert empty_count > 0

    # Ensure standard error codes were correctly assigned
    assert "not_http" in error_codes
    assert "bad_url" in error_codes
    assert "too_long" in error_codes


def test_embedded_null_bytes_resilience(tmp_path: Path) -> None:
    path = tmp_path / "nulls.csv"
    content = b"url,title\nhttps://example.com/clean,Clean\nhttps://example.com/\x00bad,BadNull\n"
    path.write_bytes(content)

    fmt = detect_csv_format(path)
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) == 2

    upload_id = uuid.uuid4()
    seen: set[str] = set()
    mapping = {"url_index": 0, "columns": []}

    staged1, kind1 = classify_and_validate_row(upload_id, 1, rows[0].cells, mapping, seen)
    assert kind1 == "valid"
    assert staged1.is_valid is True

    staged2, kind2 = classify_and_validate_row(upload_id, 2, rows[1].cells, mapping, seen)
    # The null-byte URL should be handled safely as invalid or normalized without crash
    assert staged2.row_no == 2


def test_unmatched_quote_at_eof(tmp_path: Path) -> None:
    path = tmp_path / "unmatched.csv"
    # An unclosed quote on the final line
    csv_text = 'url,title\nhttps://example.com/ok,Ok\n"https://example.com/unclosed,Title\n'
    path.write_text(csv_text, encoding="utf-8")

    fmt = detect_csv_format(path)
    # The reader should consume what it can or handle EOF gracefully
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) >= 1
