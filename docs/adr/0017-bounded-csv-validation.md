# ADR 0017: Bounded CSV validation memory and row limits

Date: 2026-10-25. Status: accepted. Resolves readiness review B5.

## Decision

CSV validation uses an exact SQLite duplicate index in an attempt-local temporary
directory. Its page cache is limited to 2 MiB. The index is disposable, so journaling
and synchronous durability are disabled; PostgreSQL remains the durable source.
Duplicate flags still use the full normalized URL, including duplicates crossing
1,000-row staging batches. No hash approximation or false-positive duplicates.

Error CSV rows are written to a temporary UTF-8 file and streamed to Storage in
64 KiB chunks. Downloads are streamed to disk with the same chunk bound. An upload
retry reopens the report from the beginning. The validator uploader callback now
accepts a Path, not a complete bytes object, and must consume it before returning.
The Storage client retains its bytes API for other small callers.

`CSV_MAX_ROWS` defaults to 2,000,000, is configurable and must be positive. Count
logical data records, excluding the header/preamble and including valid, invalid,
empty and duplicate records. Exactly the limit is allowed. The first excess
record fails with `csv_row_limit_exceeded:<limit>`; do not silently truncate or
publish partial success. The runner stores the reason in `status_reason`, which
the existing upload panel displays, and does not retry an input-limit violation.

The existing fenced PostgreSQL transaction owns deletion, every staging batch and
the Ready summary. A cap breach or parse error rolls it back, including batches
already flushed. Claims are released through the existing permanent-failure path.
Temporary duplicate and report files close and are removed on normal completion,
exceptions and cooperative cancellation. Hard process termination may leave OS
temporary files; deployment needs ordinary temp-directory housekeeping.

Memory no longer grows with the distinct-URL set or accumulated error report.
Remaining working memory includes a bounded 1,000-row batch, a parsed record,
format samples and existing bounded URL/domain caches; unusually wide records
can still increase the batch footprint. Disk usage grows with input, the exact
index and report. Provision temporary disk accordingly; disk exhaustion fails the
attempt rather than omitting duplicate checks. Existing processing timeout and
CSV field-size limits remain in force. Error-report Storage failure retains the
existing behavior: log it, publish counts without a report link.

## Compatibility and verification

No schema migration or data rewrite is required. Deploy worker code together
with the Path-based report callback; old workers do not enforce the new cap.
The existing local Storage fixture was updated to the new callback contract.
Rollback restores the prior worker, but also restores its unbounded memory paths.

Regression tests cover cap counting, exact-limit acceptance, rollback after a
flushed batch, cross-batch normalized duplicates, temporary-file cleanup and
chunked Storage upload/download with a duplicate-object retry. Existing CSV claim,
stale-owner, disconnect and cancellation tests must continue to pass.

`scripts/benchmark_csv_memory.py` runs real validation and PostgreSQL staging with
chunked local Storage fixtures, verifies final counts, records process peak RSS,
and deletes its fixture job afterward. Run each size in a fresh process. It is
an explicit local benchmark, not evidence of live Supabase Storage/browser or
production throughput. Results are recorded in the readiness review.
