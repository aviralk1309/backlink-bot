"""CSV ingestion with recoverable leases and fenced staging transactions."""

from __future__ import annotations

import asyncio
import json
import tempfile
import uuid
from pathlib import Path
from typing import Any

import httpx
import psycopg
import structlog
from psycopg_pool import AsyncConnectionPool

from worker.config.settings import Settings
from worker.io.csv_format import detect_csv_format
from worker.io.csv_reader import CsvReadError
from worker.io.csv_validator import CsvRowLimitError, validate_and_stage_csv
from worker.io.storage import StorageClient

CSV_BUCKET = "csv-uploads"


class LostCsvClaim(Exception):
    """This attempt no longer owns the upload and must not publish results."""


class CsvRunner:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        settings: Settings,
        stop: asyncio.Event,
        max_pickups_per_tick: int = 5,
        *,
        worker_id: str | None = None,
    ) -> None:
        self._pool = pool
        self._settings = settings
        self._stop = stop
        self._poll = settings.poll_seconds
        self._max_pickups = max_pickups_per_tick
        self._worker_id = worker_id or f"csv-{uuid.uuid4()}"
        self._log = structlog.get_logger()
        self._storage = (
            StorageClient(settings.supabase_url, settings.supabase_service_role_key)
            if settings.supabase_url and settings.supabase_service_role_key
            else None
        )

    async def run(self) -> None:
        self._log.info("csv_runner_started")
        while not self._stop.is_set():
            try:
                await self.tick()
            except Exception:
                self._log.exception("csv_runner_tick_failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._poll)
            except TimeoutError:
                pass
        self._log.info("csv_runner_stopped")

    async def _reap(self) -> int:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select public.worker_reap_csv_uploads(%s)",
                (self._settings.csv_max_attempts,),
            )
            row = await cur.fetchone()
            return int(row[0]) if row else 0

    async def tick(self) -> int:
        await self._reap()
        processed = 0
        for _ in range(self._max_pickups):
            if self._stop.is_set():
                break
            claimed = await self._claim_next()
            if claimed is None:
                break
            await self._process_upload(claimed)
            processed += 1
        return processed

    async def _claim_next(self) -> dict[str, Any] | None:
        columns = (
            "id",
            "job_id",
            "kind",
            "competitor_label",
            "filename",
            "storage_path",
            "mapping",
            "file_info",
            "claim_token",
            "processing_attempts",
        )
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                f"select {', '.join(columns)} from public.worker_claim_csv_upload(%s, %s, %s)",
                (
                    self._worker_id,
                    self._settings.csv_lease_seconds,
                    self._settings.csv_max_attempts,
                ),
            )
            row = await cur.fetchone()
            return dict(zip(columns, row, strict=True)) if row else None

    async def _renew(self, upload: dict[str, Any]) -> bool:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select public.worker_renew_csv_claim(%s, %s, %s)",
                (upload["id"], upload["claim_token"], self._settings.csv_lease_seconds),
            )
            row = await cur.fetchone()
            return bool(row and row[0])

    async def _keep_lease(self, upload: dict[str, Any]) -> None:
        while True:
            await asyncio.sleep(self._settings.csv_lease_seconds / 3)
            if not await self._renew(upload):
                raise LostCsvClaim()

    async def _download(self, upload: dict[str, Any], local_file: Path) -> None:
        assert self._storage is not None
        download = asyncio.create_task(
            self._storage.download_file(CSV_BUCKET, upload["storage_path"], local_file)
        )
        heartbeat = asyncio.create_task(self._keep_lease(upload))
        try:
            done, _ = await asyncio.wait((download, heartbeat), return_when=asyncio.FIRST_COMPLETED)
            if heartbeat in done:
                await heartbeat  # lease loss / DB error cancels the download
            await download
        finally:
            for task in (download, heartbeat):
                if not task.done():
                    task.cancel()
            await asyncio.gather(download, heartbeat, return_exceptions=True)

    async def _process_upload(self, upload: dict[str, Any]) -> None:
        log = self._log.bind(upload_id=str(upload["id"]), job_id=str(upload["job_id"]))
        log.info("csv_processing_started", attempt=upload["processing_attempts"])
        try:
            if not self._storage:
                await self._fail_upload(upload, "csv_storage_not_configured")
                return
            async with asyncio.timeout(self._settings.csv_processing_timeout_seconds):
                with tempfile.TemporaryDirectory() as tmp_dir:
                    local_file = Path(tmp_dir) / f"{upload['id']}.csv"
                    await self._download(upload, local_file)
                    await self._stage(upload, local_file)
            log.info("csv_processing_succeeded")
        except LostCsvClaim:
            log.warning("csv_claim_lost")
        except asyncio.CancelledError:
            # A killed process cannot run cleanup; the reaper recovers it.
            try:
                await self._fail_upload(upload, "csv_processing_cancelled", retryable=True)
            except Exception:
                log.exception("csv_release_failed")
            raise
        except CsvRowLimitError as exc:
            await self._fail_upload(upload, str(exc))
        except CsvReadError as exc:
            await self._fail_upload(upload, f"csv_format_error:{exc.code}")
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            await self._fail_upload(
                upload,
                f"csv_storage_http:{status}",
                retryable=status >= 500 or status == 429,
            )
        except (
            TimeoutError,
            httpx.TransportError,
            psycopg.OperationalError,
            psycopg.InterfaceError,
        ):
            log.exception("csv_processing_transient_error")
            await self._fail_upload(upload, "csv_processing_transient_error", retryable=True)
        except Exception as exc:
            log.exception("csv_validation_failed")
            await self._fail_upload(upload, f"csv_validation_error:{type(exc).__name__}")

    async def _stage(self, upload: dict[str, Any], local_file: Path) -> None:
        async with self._pool.connection() as conn, conn.transaction():
            # Lock BEFORE deleting/staging rows. The reaper skips our row, so
            # ownership cannot change during this bounded transaction.
            # Stop the download heartbeat before taking this lock.
            cur = await conn.execute(
                "select id from public.csv_uploads where id = %s and claim_token = %s"
                " and status = 'processing' and lease_expires_at > clock_timestamp() for update",
                (upload["id"], upload["claim_token"]),
            )
            if not await cur.fetchone():
                raise LostCsvClaim()
            fmt = detect_csv_format(local_file)

            async def uploader(path: str, data: Path) -> None:
                assert self._storage is not None
                await self._storage.upload_file(CSV_BUCKET, path, data)

            stats, error_report_path = await validate_and_stage_csv(
                conn=conn,
                upload_id=upload["id"],
                file_path=local_file,
                mapping=upload["mapping"] or {},
                storage_uploader=uploader,
                job_id=upload["job_id"],
                attempt_token=upload["claim_token"],
                max_rows=self._settings.csv_max_rows,
            )
            cur = await conn.execute(
                "update public.csv_uploads set total_rows = %s, valid_rows = %s,"
                " invalid_rows = %s, empty_rows = %s, duplicate_rows = %s,"
                " error_report_path = %s, file_info = %s::jsonb, status = 'ready',"
                " status_reason = null, locked_by = null, claim_token = null,"
                " lease_expires_at = null"
                " where id = %s and claim_token = %s and status = 'processing'",
                (
                    stats.total_rows,
                    stats.valid_rows,
                    stats.invalid_rows,
                    stats.empty_rows,
                    stats.duplicate_rows,
                    error_report_path,
                    json.dumps(fmt.to_file_info()),
                    upload["id"],
                    upload["claim_token"],
                ),
            )
            if cur.rowcount != 1:
                raise LostCsvClaim()  # rolls back all staged changes

    async def _fail_upload(
        self,
        upload: dict[str, Any],
        reason: str,
        *,
        retryable: bool = False,
    ) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "update public.csv_uploads set status = case"
                " when %s and processing_attempts < %s then 'mapped'"
                " else 'failed' end::public.csv_upload_status,"
                " status_reason = %s, locked_by = null, claim_token = null, lease_expires_at = null"
                " where id = %s and claim_token = %s and status = 'processing'",
                (
                    retryable,
                    self._settings.csv_max_attempts,
                    reason[:500],
                    upload["id"],
                    upload["claim_token"],
                ),
            )
