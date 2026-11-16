# ADR 0020: Persistent per-job domain check admission

Status: accepted, 2026-10-26. Implements M5-S5.

## Decision

Enforce the per-domain budget inside `claim_opportunity_checks`, before a URL is
returned to the worker handler. A Python-side counter cannot enforce a limit
across processes or prevent skipped pages from being fetched.

`domain_check_budgets` stores the effective cap and admitted count per
`(job_id, registered_domain)`. `opportunity_check_admissions` records each URL's
first admission. Reservation, counter increment and claim commit together.
Retries, graceful release, expired leases and final failures retain admission;
the budget counts unique attempted URLs, not HTTP attempts. A rollback releases
both the reservation and claim. Post-fetch merging does not refund already spent
work. No reset/refund endpoint is provided.

The existing job-stats trigger remains the sole owner of `unchecked_count`.
Non-admitted URLs are updated to `skipped / domain_cap`, tier `unchecked`, queue
`backlog`, with no score or active lease. They never enter the handler and their
attempt counter remains unchanged. Blocklisted/auto-filtered and merged rows are
excluded before admission and retain their original reasons.

## Cap and ordering semantics

Activity fit is only known after fetching. Therefore admission uses the selected
activities in the job config, not the activity eventually inferred from page HTML.
A new trigger captures enabled selected activities' cap values in
`job_config_history.snapshot.activity_check_caps` when the snapshot is created.
The effective cap is the largest selected override, or the frozen job cap when
there is no override. This is one shared domain budget, not a sum or a separate
quota for each activity. This choice permits the most inclusive selected activity
without multiplying fetches. It implements the specified activity-over-job override.

Existing snapshots are not rewritten. Legacy snapshots without the override map
use their stored job cap. A job created directly without lifecycle snapshots uses
its current job cap (needed for existing administrative/test fixtures).

Each domain freezes its effective cap and config version on first admission.
Later config edits do not refill or rewrite that domain's budget; a newly seen
domain may use a newer config snapshot. Profile changes cannot silently change an
already recorded snapshot. Existing attempted/running/done URLs are backfilled as
consumed admissions by the migration, even if historical consumption exceeds the
new cap; completed work is never undone.

Within a domain, order is overlap count descending, distinct Google query source
count descending, discovery time, then UUID. The source-table primary key makes
counting Google rows a distinct-query count. `found_by_count` is unsuitable because
it also includes CSV and seed sources. The domain order takes precedence over
source-class priority inside that domain. Across jobs/domains, source priority
still schedules gap work ahead of seed/search work.

Selection uses evidence committed at admission time. Future discoveries or new
source evidence cannot displace an already admitted URL, undo a fetch, or silently
reopen a `domain_cap` row. Global ranking over URLs not yet discovered is impossible
for a streaming pipeline; this is intentionally not promised.

## Concurrency and bounds

Short admission transactions acquire a job `FOR NO KEY UPDATE SKIP LOCKED` lock,
then budget and opportunity locks. This serializes admissions within one job while
letting other workers admit work for other jobs. The job lock remains compatible
with discovery's foreign-key key-share locks. Eligible job states remain running
and saturated. The public claim signature and Python engine interface are unchanged.

Within the chosen domain, opportunity rows are not skipped when locked: doing so
could spend the last slot on a lower-ranked row. Claims use the actual database
clock for lease start rather than the start of a potentially waiting transaction.
At most 1,000 candidates are processed per call; large over-cap domains drain over
subsequent polls. An empty returned batch may have made progress by skipping rows.
No connection or transaction is held while page fetching/checking occurs.

API roles cannot execute claim/admission functions or mutate the budget tables.
Workers can inspect the tables but cannot directly create or refill admissions.
The worker's supported claim path is the only writer. Existing worker privileges
on opportunity state remain unchanged.

## Rollout and rollback

Apply `20261026030000_m5_domain_check_caps.sql` before enabling a check handler.
The migration preserves existing work and adds the budget tables, snapshot trigger
and pending-domain index. The live S9 handler remains unwired.

Application rollback can retain the cap-aware claim function because its signature
is unchanged. Do not restore the old uncapped claim function while workers are
running. Retain admission history when rolling back application code; dropping
budget tables or resetting counters would allow repeated work.

## Evidence

Four real worker engines with 50 same-domain URLs execute exactly ten complete S4
check pipelines, persist 80 check rows, and leave 40 untouched-by-handler URLs in
Unchecked Backlog. Tests cover source ranking, deterministic ties, retries,
graceful release, expired leases, rollback, job/domain isolation, late discoveries,
frozen overrides, exclusions and bounded draining. Existing engine tests use an
explicit generous cap when they are testing 60/200-row lease mechanics.


Verification on 2026-10-26: 761 worker tests and 244 focused SQL assertions pass
(claim/lease, cap, lifecycle, runner and counter suites). Ruff lint/format, strict
mypy, web TypeScript checks and generated-type formatting pass. The migration is
applied locally. The populated-database caveat for the full pristine SQL suite
remains documented in the readiness review.
