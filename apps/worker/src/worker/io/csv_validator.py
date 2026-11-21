"""CSV validation and staging for M4-S5.

Validates URLs, extracts extras according to mapping, checks within-file duplicates,
and stages rows into public.csv_rows with flat memory.
Enforces: total_rows = valid_rows + invalid_rows + empty_rows.
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
import tempfile
import uuid
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

import structlog
from psycopg import AsyncConnection

from worker.io.csv_format import detect_csv_format
from worker.io.csv_reader import iter_csv_rows
from worker.urls.normalize import normalize_url

MAX_RAW_URL_LENGTH = 4096
BATCH_SIZE = 1000
DEFAULT_MAX_ROWS = 2_000_000


def safe_error_csv_cell(value: str) -> str:
    if re.match(r"^[\s\x00]*[=+\-@＝＋－＠]|^[\t\r\n\x00]", value):
        return f"'{value}"
    return value


class CsvRowLimitError(ValueError):
    def __init__(self, limit: int) -> None:
        super().__init__(f"csv_row_limit_exceeded:{limit}")


class SeenUrls(Protocol):
    def __contains__(self, url: str) -> bool: ...
    def add(self, url: str) -> None: ...


class DiskSeenUrls:
    """Exact duplicate index with a bounded SQLite cache; scratch data only."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        conn.execute("pragma cache_size = -2048")  # 2 MiB page cache
        conn.execute("pragma journal_mode = off")
        conn.execute("pragma synchronous = off")
        conn.execute("create table seen (url text primary key) without rowid")

    def __contains__(self, url: str) -> bool:
        return self.conn.execute("select 1 from seen where url = ?", (url,)).fetchone() is not None

    def add(self, url: str) -> None:
        self.conn.execute("insert into seen(url) values (?)", (url,))


RowClassification = Literal["valid", "invalid", "empty"]


@dataclass(slots=True)
class ValidationStats:
    total_rows: int = 0
    valid_rows: int = 0
    invalid_rows: int = 0
    empty_rows: int = 0
    duplicate_rows: int = 0

    def check_counts(self) -> bool:
        return self.total_rows == (self.valid_rows + self.invalid_rows + self.empty_rows)


@dataclass(slots=True)
class StagedRow:
    upload_id: uuid.UUID
    row_no: int
    raw_url: str
    normalized_url: str | None
    host: str | None
    domain: str | None
    extras: str  # JSON-encoded dict
    is_valid: bool
    is_duplicate: bool
    error_code: str | None


def classify_and_validate_row(
    upload_id: uuid.UUID,
    row_no: int,
    cells: tuple[str, ...],
    mapping: dict[str, Any],
    seen_urls: SeenUrls,
) -> tuple[StagedRow, RowClassification]:
    url_index = mapping.get("url_index", 0)
    raw_cell = cells[url_index] if 0 <= url_index < len(cells) else ""
    raw_url = raw_cell.strip()[:MAX_RAW_URL_LENGTH]

    # Check if empty
    if not raw_url or not any(c.strip() for c in cells):
        return (
            StagedRow(
                upload_id=upload_id,
                row_no=row_no,
                raw_url=raw_url,
                normalized_url=None,
                host=None,
                domain=None,
                extras="{}",
                is_valid=False,
                is_duplicate=False,
                error_code="empty_row",
            ),
            "empty",
        )

    # Extract mapped extras
    extras_dict: dict[str, Any] = {}
    for col in mapping.get("columns", []):
        idx = col.get("index")
        if idx is None or idx == url_index or idx >= len(cells):
            continue
        col_type = col.get("type", "text")
        if col_type == "ignore":
            continue
        label = col.get("label") or col.get("source") or f"col_{idx}"
        val_str = cells[idx].strip()
        if not val_str:
            continue
        if col_type == "number":
            try:
                extras_dict[label] = int(val_str)
            except ValueError:
                try:
                    extras_dict[label] = float(val_str)
                except ValueError:
                    extras_dict[label] = val_str
        else:
            extras_dict[label] = val_str

    extras_json = json.dumps(extras_dict)

    # Normalize URL
    norm = normalize_url(raw_url)
    if not norm.ok:
        # Map normalization errors to spec error codes
        if norm.error == "unsupported_scheme":
            code = "not_http"
        elif norm.error == "too_long":
            code = "too_long"
        else:
            code = "bad_url"

        return (
            StagedRow(
                upload_id=upload_id,
                row_no=row_no,
                raw_url=raw_url,
                normalized_url=None,
                host=None,
                domain=None,
                extras=extras_json,
                is_valid=False,
                is_duplicate=False,
                error_code=code,
            ),
            "invalid",
        )

    # Valid URL
    normalized = norm.normalized
    assert normalized is not None
    is_duplicate = normalized in seen_urls
    if not is_duplicate:
        seen_urls.add(normalized)

    return (
        StagedRow(
            upload_id=upload_id,
            row_no=row_no,
            raw_url=raw_url,
            normalized_url=normalized,
            host=norm.host,
            domain=norm.registered_domain,
            extras=extras_json,
            is_valid=True,
            is_duplicate=is_duplicate,
            error_code=None,
        ),
        "valid",
    )


async def flush_staged_rows(conn: AsyncConnection[Any], rows: list[StagedRow]) -> None:
    if not rows:
        return
    query = """
    insert into public.csv_rows (
      upload_id, row_no, raw_url, normalized_url, host, domain,
      extras, is_valid, is_duplicate, error_code
    ) values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
    """
    params = [
        (
            r.upload_id,
            r.row_no,
            r.raw_url,
            r.normalized_url,
            r.host,
            r.domain,
            r.extras,
            r.is_valid,
            r.is_duplicate,
            r.error_code,
        )
        for r in rows
    ]
    async with conn.cursor() as cur:
        await cur.executemany(query, params)


async def validate_and_stage_csv(
    conn: AsyncConnection[Any],
    upload_id: uuid.UUID,
    file_path: Path,
    mapping: dict[str, Any],
    *,
    storage_uploader: Any | None = None,
    job_id: uuid.UUID | None = None,
    attempt_token: uuid.UUID | None = None,
    max_rows: int = DEFAULT_MAX_ROWS,
) -> tuple[ValidationStats, str | None]:
    """Reads, validates, and stages all rows from a CSV file into public.csv_rows.

    Returns (stats, error_report_path). The caller must own a transaction so
    parse errors, cancellation and row-cap breaches roll back every batch.
    storage_uploader receives (object_key, temporary_path) and must consume the
    file before returning; it is deleted on exit. Raises CsvReadError for parse
    failures and CsvRowLimitError at the first data record above max_rows.
    """
    if max_rows < 1:
        raise ValueError("max_rows must be positive")
    log = structlog.get_logger().bind(upload_id=str(upload_id))

    fmt = detect_csv_format(file_path)
    header_line = fmt.header.header_line

    # Clear any previous staged rows for this upload (safe idempotent re-read)
    await conn.execute("delete from public.csv_rows where upload_id = %s", (upload_id,))

    # Contexts also clean up on parse errors, limit breaches and cancellation.
    with tempfile.TemporaryDirectory(prefix="csv-validation-") as scratch:
        report_file = Path(scratch) / "errors.csv"
        with (
            closing(sqlite3.connect(Path(scratch) / "seen.sqlite")) as index,
            report_file.open("w", encoding="utf-8", newline="") as error_buffer,
        ):
            stats = ValidationStats()
            seen_urls = DiskSeenUrls(index)
            buffer: list[StagedRow] = []

            error_writer = csv.writer(error_buffer)
            error_writer.writerow(["row_no", "raw_url", "error_reason"])

            for csv_row in iter_csv_rows(file_path, fmt, header_line=header_line):
                if stats.total_rows >= max_rows:
                    raise CsvRowLimitError(max_rows)
                staged, classification = classify_and_validate_row(
                    upload_id=upload_id,
                    row_no=csv_row.row_no,
                    cells=csv_row.cells,
                    mapping=mapping,
                    seen_urls=seen_urls,
                )

                stats.total_rows += 1
                if classification == "valid":
                    stats.valid_rows += 1
                    if staged.is_duplicate:
                        stats.duplicate_rows += 1
                elif classification == "invalid":
                    stats.invalid_rows += 1
                    error_writer.writerow(
                        [staged.row_no, safe_error_csv_cell(staged.raw_url), staged.error_code]
                    )
                elif classification == "empty":
                    stats.empty_rows += 1
                    error_writer.writerow(
                        [staged.row_no, safe_error_csv_cell(staged.raw_url), staged.error_code]
                    )

                buffer.append(staged)
                if len(buffer) >= BATCH_SIZE:
                    await flush_staged_rows(conn, buffer)
                    buffer.clear()

            if buffer:
                await flush_staged_rows(conn, buffer)
                buffer.clear()

            assert stats.check_counts(), (
                f"Counts do not add up: total={stats.total_rows}, "
                f"valid={stats.valid_rows}, invalid={stats.invalid_rows}, empty={stats.empty_rows}"
            )

            error_report_path: str | None = None
            if (stats.invalid_rows > 0 or stats.empty_rows > 0) and storage_uploader and job_id:
                suffix = f"_{attempt_token}" if attempt_token else ""
                error_report_path = f"{job_id}/{upload_id}{suffix}_errors.csv"
                try:
                    error_buffer.flush()
                    await storage_uploader(error_report_path, report_file)
                except Exception:
                    log.exception("failed_to_upload_error_report")
                    error_report_path = None

    log.info(
        "csv_validation_complete",
        total=stats.total_rows,
        valid=stats.valid_rows,
        invalid=stats.invalid_rows,
        empty=stats.empty_rows,
        duplicate=stats.duplicate_rows,
    )

    return stats, error_report_path
