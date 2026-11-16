# ADR 0014: Atomic pickup and source import

Status: Accepted (2026-10-25, readiness finding B2)

## Problem

The runner committed Queued → Running before importing seeds. A second runner
could complete the apparently empty job, or a crash could strand it without its
seeds. Gap import ran twice: once in SQL pickup and once in Python. Python import
exceptions were logged but allowed the completion sweep to run.

## Decision

Use one Postgres transaction for pickup, gap import and seed import. The SQL
pickup primitive keeps `FOR UPDATE SKIP LOCKED` and readiness checks, but no
longer imports the gap itself. Python invokes `import_job_gap_and_seeds` once,
on the same connection before committing. It imports gap rows before seed rows.

The job lock stays held throughout. Other sessions see Queued until all rows,
source records, counters and Running status commit together. Another runner
skips the locked job; check claims and completion cannot see a prematurely
Running job. Job edits and controls serialize against the same lock.

Imports have a nested savepoint. Non-transient exceptions roll back both imports
and their counters, then atomically set Failed with
`import_failed:<ExceptionClass>` in the job and status-change event. The reason
does not include URLs or raw database error text. Subsequent jobs can proceed.
Operational/connection errors escape and roll back pickup too, leaving the job
Queued for the next polling attempt. Cancellation or connection termination
also rolls back the entire transaction. Success is logged only after commit.

This is deliberately narrower than the review's proposed durable import-phase
table and leases. Import reads already-staged database rows and normalizes seed
URLs locally; it has no Storage download, external HTTP or separate commit to
coordinate. Postgres transactions provide ownership and crash recovery here.
The existing `job_work_pending` check-only definition remains sufficient for
this entry path because Running is never published before imports finish.
Direct callers of `worker_pick_up_next_job` must honor that transaction contract.
CSV file ingestion (B3) is separate and still needs its own recovery fix.

## Tradeoffs and review triggers

The job remains visibly Queued during import. A Stop/control request concurrent
with import waits for this transaction to release the job lock. No new checks
are claimed while import is uncommitted. Controls take effect once they acquire
the lock; this does not introduce mid-import cancellation.

For imports too large to tolerate one transaction, or future network work,
revisit a durable import-phase table with leases and make `job_work_pending`
include that phase before splitting transactions. Search generation in M8 must
also add its own pending-work condition. This change is not a large-import
performance certification.

## Deployment and rollback

No table, data shape, role, grant or function signature changes. Browser readers
and source import functions are unchanged. Use a coordinated worker rollout:

1. Stop all old runners; let open transactions finish or roll back.
2. Apply `20261025010000_atomic_job_import.sql`.
3. Start the matching runner code. Do not mix old and new runners: the old
   runner still commits pickup before seed import, regardless of SQL version.
4. Verify a seeded job and the runner integration suite before enabling traffic.

Rollback: stop runners, restore only the `worker_pick_up_next_job` definition
from section 4 of `20261023040000_m4_gap_import.sql` in a compensating migration,
then restore the previous worker version. No data rollback is required. This
restores the known B2 defect, so keep runners disabled unless that risk is
explicitly accepted. Never reset the database as a rollback method.

Existing jobs completed or stranded by the old code are not automatically
rewritten. Investigate affected job IDs before any repair; committed outcomes
cannot safely be inferred from an empty opportunity list alone. The local
database contained no jobs before this change's integration verification.

## Proof

`tests/integration/test_job_runner.py` uses real worker-role DB connections and
controlled barriers to prove: two-runner exclusion, no premature completion or
check claims, cancellation and actual backend termination recovery, rollback of
gap and seed rows/counters, non-transient failure reasons, transient retry, and
Pause/Stop serialization. It also checks that the gap is created once rather
than implicitly imported by SQL first. Existing empty-job and drain tests pass.
