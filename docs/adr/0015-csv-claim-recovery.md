# ADR 0015: Recoverable CSV claims

Status: Accepted (2026-10-25, readiness finding B3)

CSV downloads cross a network boundary, so unlike the local source imports in
ADR 0014 they need durable ownership between transactions. Claims now store
`locked_by`, a fresh UUID `claim_token`, `lease_expires_at`, and a durable
`processing_attempts` count. Only the worker role can call claim/reap/renew RPCs;
existing client column grants do not permit writing these fields.

## Recovery and fencing

- Each runner tick reaps expired processing claims before claiming mapped
  uploads. Reaping uses `FOR UPDATE SKIP LOCKED`. The default is three attempts;
  exhaustion stores Failed / `csv_attempts_exhausted` instead of retrying forever.
- Claims last 120 seconds by default. During download the runner renews every
  third of that interval. An expired token cannot renew. Lease loss or renewal
  failure cancels the download; all helper tasks are awaited during cleanup.
- Before deleting or staging rows, the runner locks the upload and verifies its
  current, unexpired token. The lock stays held through validation and the final
  Ready update, so the reaper cannot reassign ownership partway through staging.
  Rows, counts, file metadata and Ready status commit together. A database
  disconnect rolls back staging; the committed claim is recovered after expiry.
- The download heartbeat is stopped before acquiring the staging lock (avoids
  a self-deadlock on renewal). The entire processing attempt has a configurable
  900-second deadline. While staging, the row lock protects ownership even if
  the original lease time elapses. A killed process releases that lock when its
  database connection closes; a hung live operation is cancelled at the deadline.
- Success and failure updates compare the attempt token. Stale attempts cannot
  replace the current summary or mark a newer attempt Failed. Error reports use
  `<job>/<upload>_<claim-token>_errors.csv`, so they cannot overwrite one another.
  Only the committed attempt's path is published. A crash after report upload
  may leave an unreferenced report object; no uploaded files are deleted here.
- Transient network/database errors and deadline expiry requeue within the
  attempt limit. File-format errors, missing Storage configuration and other
  non-transient failures remain visible failures. Graceful cancellation releases
  its current token for retry; forced process death relies on the reaper.

`CSV_LEASE_SECONDS` (10–3600, default 120), `CSV_MAX_ATTEMPTS` (default 3), and
`CSV_PROCESSING_TIMEOUT_SECONDS` (default 900) configure this behavior. Use the
same attempt limit across workers. No new queue service or paid dependency.
This change does not resolve B5's validation-memory/row-limit issue.

## Compatibility, deployment and rollback

The migration is additive and preserves existing uploads, files and staging
rows. Browser screens keep their existing statuses and follow the stored error
report path. Legacy Processing rows with no lease are recovered by the reaper;
their original attempt counts as one. Successful/confirmed uploads are untouched.

Stop all old CSV workers before applying `20261025020000_csv_claim_recovery.sql`,
then start the matching worker code. The legacy no-argument claim function now
raises `csv_worker_upgrade_required`: old code does not know its fencing token
and is unsafe to run alongside recovery. Do not roll out with mixed workers.

For rollback, stop all CSV workers. Leave the additive columns/index in place;
no data reset or column drop is needed. In a compensating migration, clear the
three ownership fields on Processing rows, requeue them as Mapped with an
explicit rollback reason, and restore only `worker_claim_next_csv_upload` from
`20261023010000_m4_csv_validation.sql`. Then restore the previous worker version.
Rolling back restores the crash-recovery defect; prefer keeping workers stopped
until the corrected version is available. Do not alter Ready/Confirmed rows or
delete files as part of rollback.

## Verification

The abandoned-claim reproduction failed on the old runner and passes now.
Real-Postgres integration tests cover exclusive claims, recovery and exhaustion,
stale-token fencing, renewal/cancellation, transient retry limits, actual backend
termination during staging, exact row/count recovery, unique error report paths,
and timeout rollback. Storage is a deterministic test fixture; these tests do
not claim live Storage/end-to-end browser verification. pgTAP covers permissions,
parameter bounds, current/wrong/expired tokens and legacy row recovery.
