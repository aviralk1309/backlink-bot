# Worker Runbook

The worker is a long-running Python process that picks up jobs from the queue,
processes opportunities, and updates the database. It uses Postgres as its queue
(ADR 0002) via `FOR UPDATE SKIP LOCKED`.

## Quick start (local)

### Prerequisites
- Python 3.12+
- uv package manager (`pip install uv`)
- Local Supabase stack running (`make db-start`)
- Worker role configured in Supabase

### Install and run

```bash
cd apps/worker

# Install dependencies
uv sync

# Run the worker
uv run python -m worker
```

The worker starts, connects to the database, logs a heartbeat every 15 seconds,
and picks up queued jobs.

## Configuration

The worker reads from `.env` in `apps/worker/` or environment variables:

`SITE_CRAWL_ENABLED=false` and `LINK_VERIFICATION_ENABLED=false` keep the new
site crawl and placed-link checks off. Before enabling either one, set
`BOT_USER_AGENT` to identify your service and include a real contact URL you
control. The worker refuses to start with the example contact when either flag
is enabled. Site crawl admits at most two child pages per domain and 20 per job
within the first five minutes. Link checks recheck submitted live placements
daily; missing links become unverified, while blocked fetches remain unknown.

```bash
# Required
DATABASE_URL=postgresql://worker:worker@127.0.0.1:54322/postgres

# Optional (defaults shown)
LOG_LEVEL=INFO
HEARTBEAT_SECONDS=15
POLL_SECONDS=5.0
CLAIM_BATCH=10
WORKER_CONCURRENCY=4
LEASE_SECONDS=120
MAX_ATTEMPTS=3
SHUTDOWN_GRACE_SECONDS=30.0
POOL_MAX_SIZE=10
RUNNER_ENABLED=true
```

See [Secrets and env vars](../secrets.md) for the full list.

## Job runner

The job runner (M3-S7) is the orchestrator. It:
1. Picks up Queued jobs and transitions them to Running
2. Monitors for drained jobs (no pending work)
3. Handles completion, saturation, and failure

Enable it with `RUNNER_ENABLED=true`. The worker logs when it picks up jobs.

Pickup and gap/seed import commit together. The job remains visibly Queued until
import finishes; other runners cannot complete it or claim its checks during
that transaction. A crash or transient database error rolls the whole operation
back for retry. A non-transient import error marks the job Failed with
`import_failed:<ExceptionClass>` in its status reason and activity log.
Pause/Stop requests concurrent with import wait for its job lock, then take
effect. See [ADR 0014](../adr/0014-atomic-job-import.md) for the transaction
contract and coordinated migration/worker deployment and rollback procedure.

## Worker engine

### CSV processing recovery

Job deletion queues Storage cleanup in `job_storage_cleanup`. The web app removes
the job's CSV files immediately when Storage is available; the worker retries
after 30 seconds if that attempt fails. Configure `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` on the worker. Check the queue and
`storage_cleanup_retry_failed` logs if files remain after deletion. Keep
the queue row until the Storage API succeeds; deleting `storage.objects` via SQL
does not remove the stored file.

Deleting an individual CSV queues its raw file and error report in
`csv_storage_cleanup` before the upload row disappears. The worker retries each
object after 30 seconds and removes the queue row only after Storage succeeds.
The Data tab shows a pending notice until the queue drains. Inspect this table
and `storage_cleanup_retry_failed` logs if a deleted file remains in Storage.

CSV claims expire after `CSV_LEASE_SECONDS` (default 120), renew during download,
and retry up to `CSV_MAX_ATTEMPTS` (default 3). The runner reaps abandoned claims
on each tick. Exhausted uploads show `csv_attempts_exhausted` in their failure
reason. `CSV_PROCESSING_TIMEOUT_SECONDS` (default 900) bounds each whole attempt.
During staging, a transaction lock protects rows and counters; cancellation or
DB loss rolls them back. Do not manually set a Processing upload to Ready.

Old CSV workers must be stopped for the claim migration. If logs show
`csv_worker_upgrade_required`, update the worker rather than disabling the
guard. See [ADR 0015](../adr/0015-csv-claim-recovery.md) for recovery, deployment
and rollback. This change has been applied to the local database only.

### Opportunity checks

The engine (M3-S6) is the claim-and-process loop. It:
1. Claims pending opportunity rows from the queue
2. Extends leases every 40 seconds (1/3 of lease time)
3. Reaps expired leases and retries failed rows
4. Releases claims on graceful shutdown

Configuration options:
- `CLAIM_BATCH`: How many rows to claim at once (default 10)
- `WORKER_CONCURRENCY`: How many rows to process simultaneously (default 4)
- `LEASE_SECONDS`: Lease duration (default 120s)
- `MAX_ATTEMPTS`: Retry limit before marking failed (default 3)
- `POLL_SECONDS`: How often to check for new work (default 5s)

## Priority order

Rows are claimed in priority order (I6):
1. **Priority 0**: Competitor CSV sources (gap detection)
2. **Priority 1**: Seed list sources
3. **Priority 2**: Google search sources

Within the same priority, older rows are claimed first.

## Search execution (M8-S4/S5/S6)

`SEARCH_ENABLED=false` is the default. With a worker-role database connection
and `SERPER_API_KEY` configured, set it to `true` to run paid queries. Confirm
M8-D2 provider rate limits and M8-D3 location mapping before production use.
Each worker runs up to two queries concurrently, and PostgreSQL caps each job
at two active claims across all workers. Claims use `SKIP LOCKED` and a renewable lease;
expired claims retry up to `MAX_ATTEMPTS` and then become `failed`.
Claims and result publication take the same per-job lock, so a finishing call
cannot race a fresh claim past the credit budget. Discoveries, the query row
and live counters commit together. If a worker dies
after Serper charges for a call but before commit, each retry can spend credit
again. The worker cannot infer an unreported charge; Serper's transient HTTP
retries for rate limits and server errors can add calls before a query attempt finishes.

Timeouts and unusable successful responses are treated as uncertain spend:
the query fails without an automatic retry, a conservative per-call amount is
reserved against the job budget, and `search_spend_uncertain` records the amount.
The dashboard separates confirmed credits from possibly charged credits. Compare
the provider's usage record before manually retrying or releasing a reservation;
do not infer that a timeout was free. A process crash during the HTTP call can
still leave an unreported charge and needs operator review.

Claims reserve one credit before the first reported response, then the highest
per-call credits reported for that job. If the balance cannot cover the next
reservation, pending queries remain stored while checks drain. Completion uses
`budget_reached`. A two-credit call can exceed the initial one-credit estimate;
with two in-flight calls, the tested maximum reported overshoot is two credits.
Unreported charges after a timeout or crash are outside that bound.

After at least `saturation_n` completed search calls, a job pauses as
Saturated if the latest N calls found fewer than `saturation_x` new registered
domains. Failed calls and CSV discoveries do not enter this window. Running
searches and pending checks finish; new searches wait for a confirmed Resume.
After Resume, the rule waits for N more completed calls before evaluating again.
`saturation_x=0` disables automatic saturation. Budget exhaustion and a fully
used query plan follow the normal completion path; a job whose every query
failed follows the existing Failed path.

## Monitoring

### Heartbeat

The worker inserts a row into `worker_heartbeats` every 15 seconds. The dashboard
shows active workers. A stale heartbeat (older than 3 intervals = 45s) indicates
a worker crash or network partition.

Query active workers:
```sql
select worker_id, host, last_seen_at, age(now(), last_seen_at) as stale
from worker_heartbeats
where last_seen_at > now() - interval '45 seconds'
order by last_seen_at desc;
```

### Job counters

Live counters are updated transactionally with each event. View them with:
```sql
select * from job_stats where job_id = '...';
```

The dashboard polls these every 5 seconds (A9).

## Common operations

### Start a worker
```bash
cd apps/worker
uv run python -m worker
```

### Stop gracefully
Send SIGTERM. The worker:
1. Stops accepting new work
2. Drains in-flight rows (up to `SHUTDOWN_GRACE_SECONDS` = 30s)
3. Releases claims
4. Removes heartbeat row
5. Exits cleanly

### Force stop
Send SIGKILL (`kill -9`). Rows in progress return to pending after lease
expiry (default 120s). They are retried by other workers.

### Run multiple workers
```bash
# Worker 1
cd apps/worker && uv run python -m worker

# Worker 2 (different terminal)
cd apps/worker && uv run python -m worker
```

Two workers never process the same row. The claim uses `FOR UPDATE SKIP LOCKED`.

## Troubleshooting

### Worker starts but claims no rows

Check:
1. **Job status**: Are there Queued or Running jobs?
   ```sql
   select id, name, status from jobs where status in ('queued', 'running');
   ```
2. **Pending rows**: Are there claimable opportunities?
   ```sql
   select count(*) from opportunities 
   where check_status = 'pending' and job_id in (
     select id from jobs where status in ('running', 'saturated')
   );
   ```
3. **Worker role**: Does the worker have the correct permissions?
   ```sql
   select rolname from pg_roles where rolname = 'worker';
   ```
4. **Runner enabled**: Is `RUNNER_ENABLED=true`? Without it, the job runner
   does not start, so jobs stay Queued.

### Worker crashes immediately

Check:
1. **Database connection**: Can you connect manually?
   ```bash
   psql postgresql://worker:worker@127.0.0.1:54322/postgres -c "select 1"
   ```
2. **Environment**: Is `DATABASE_URL` set correctly?
3. **Logs**: The worker logs errors before crashing. Look for connection errors
   or missing tables.

### Lease lost warnings

These appear when the database cannot extend a lease. Common causes:
1. **Network latency**: Increase `LEASE_SECONDS` or reduce `WORKER_CONCURRENCY`
2. **Long-running operations**: A handler takes longer than the lease
   extension interval (40s). Optimize the handler or increase `LEASE_SECONDS`
3. **Database load**: Postgres is slow to respond. Check database metrics

Lease lost means the row returns to pending and another worker may claim it.
The original worker drops its result. This is safe.

### Rows stuck in "running"

A worker crashed mid-processing. After the lease expires (default 120s), the
reaper returns retryable rows to pending and marks exhausted rows failed.
Inspect the affected job before intervening:

```sql
select id, attempts, locked_by, lease_expires_at
from public.opportunities
where job_id = '<job-uuid>' and check_status = 'running'
order by lease_expires_at;
```

If the leases have expired and the worker reaper has not run, use the bounded
RPC as the `worker` database role. Match `p_max_attempts` to the worker's
`MAX_ATTEMPTS` setting (default 3), record the returned counts in the incident
log, then rerun the query above to confirm those rows left `running`:

```sql
select * from public.reap_expired_leases(p_max_attempts => 3, p_limit => 500);
```

### Max attempts exceeded

A row failed `MAX_ATTEMPTS` times (default 3). It is marked as `failed` with
a reason. Check:

```sql
select id, normalized_url, check_reason, attempts
from opportunities
where check_status = 'failed'
order by updated_at desc;
```

Fix the underlying issue (bad URL, network problem) and the row stays failed.
A job with many failed rows may indicate a broader problem.

## Performance tuning

### For a powerful database
```bash
# More concurrent processing
WORKER_CONCURRENCY=8
CLAIM_BATCH=20

# Longer leases (more time for slow operations)
LEASE_SECONDS=300
```

### For a weak database or many workers
```bash
# Fewer concurrent operations
WORKER_CONCURRENCY=2
CLAIM_BATCH=5

# Shorter leases (faster recovery from crashes)
LEASE_SECONDS=60
POLL_SECONDS=2.0
```

### For production
- Set `WORKER_CONCURRENCY` based on database connection limits
- Set `CLAIM_BATCH` to match typical row processing time
- Monitor `lease_expires_at` to detect slow handlers
- Use `RUNNER_ENABLED=true` for job orchestration

## Testing

Run the worker test suite:
```bash
# Unit tests (fast, no database)
uv run pytest -m unit

# Integration tests (require local Supabase)
uv run pytest -m integration

# All tests
uv run pytest
```

See [Testing](../testing.md) for details.

### Fetch dispatch coordination (ADR 0016)

Before enabling M5 fetching, apply migration `20261025030000_fetch_rate_limits.sql`
and construct one `PoliteFetcher(config, pool=pool)` per worker using its worker-role
pool. All workers must use the same `FETCH_DOMAIN_DELAY_SECONDS` (default 2).
Drain old fetchers when upgrading or changing this interval. The process-local
limiter is only for explicit single-process tools/tests. Database failure blocks
dispatch and must be retried/deferred by the runner as infrastructure failure.
`FETCH_TOTAL_TIMEOUT` (default 15 seconds) includes queueing, DNS, rate waits,
redirects, retries and streaming; a saturated domain may time out before HTTP.
See [ADR 0016](../adr/0016-shared-fetch-budgets.md) for rollout/rollback and the
required shared coordination for future robots requests.

### CSV resource limits (ADR 0017)

`CSV_MAX_ROWS=2000000` limits logical data records per upload, including invalid,
empty and duplicate records; header/preamble records do not count. An excess
record fails the upload with `csv_row_limit_exceeded:<limit>` and rolls back all
staging. Split the export or deliberately raise the configured cap, then upload
again. The existing processing deadline still applies.

Validation stores its exact duplicate index and error report in temporary files;
Storage transfers use 64 KiB chunks. Provision temp disk for the downloaded CSV,
SQLite index and report, and clean abandoned OS temp files after hard worker
termination. The existing 1,000-row staging batch and per-record parser limits
remain. See [ADR 0017](../adr/0017-bounded-csv-validation.md).


## M5-S2 robots cache

Apply `20261026010000_m5_origin_robots_cache.sql` before constructing
`PoliteFetcher(pool=pool)`. This enables shared robots policy automatically.
Existing domain-level robots and blocked flags are ignored; never copy them
across origins. Rules/404/410 results last 24 hours; unavailable results and block
cooldowns default to 15 minutes. Retry-After can extend a cooldown to one day.
Domain facts independently expire after seven days.

`could_not_check` reasons distinguish `robots_disallowed_for_bot`,
`robots_unavailable`, and `origin_blocked_cooldown`. They must remain unchecked,
not rejected. A total deadline still returns `timeout`. A database error must
retry at the job infrastructure layer, never bypass coordination.

A cancelled/crashed refresh recovers after its 60-second lease expires. Inspect
`origin_robots_cache` as an administrator for `refresh_until`, `expires_at` and
`blocked_until`. Do not manually clear active leases or cooldowns to force traffic.
Rollback can retain this additive cache table. Full runner wiring remains M5-S9.


## M5-S4 free checks

Run `uv sync --frozen` before starting the updated worker environment. S4 adds
Lingua's bundled offline language models and the eight pure checks; the live
check handler remains scheduled for S9. Supply final-origin robots evidence,
fresh domain facts and pinned activity profiles to `CheckContext` before calling
`default_registry().run(context)`. Missing evidence stays unknown.

Classification/defaults and the detector benchmark are in ADR 0019. Do not treat
spam warnings alone as an auto-filter, copy alternate-page hreflang to the current
page, or fetch canonical URLs from a check. Activity assignment is returned in
check evidence for the future atomic scoring/queue write.

The required dependency audit also prompted these transitive updates: Brotli
1.2.1, certifi 2026.10.23 and filelock 4.2.4. Keep the lockfile with the deployment.
No S4 schema migration is needed; S3 persistence remains compatible.


## M5-S5 domain check caps

Apply `20261026030000_m5_domain_check_caps.sql` before the live check handler is
enabled. The existing claim RPC now reserves unique-URL admission before returning
work; Python callers need no signature change. Inspect `domain_check_budgets` and
`opportunity_check_admissions` as worker/admin when diagnosing `domain_cap` rows.

Cap overflow is skipped, Unchecked and Backlog, never deleted. Retries retain the
same admission. Do not reset counters or manually reopen skipped rows to force
traffic. Large over-cap batches drain in chunks of at most 1,000 candidates per
claim call, so empty returns do not necessarily mean the job is drained.

Activity overrides are captured in new config snapshots. Legacy snapshots use
their stored job cap. Each domain's cap freezes on first admission; changed caps
apply to newly seen domains, not previously consumed budgets. See ADR 0020.
Application rollback can retain this signature-compatible migration; reverting
to the uncapped SQL claimant requires stopping check workers first.


## M5-S6 auto-filter publication

Apply `20261027010000_m5_auto_filter.sql` before calling
`publish_checks_and_filter`. Pass thresholds from the pinned config. A returned
decision means the opportunity is complete and Auto-filtered; `None` means keep
processing it through scoring/queue assignment. Use the same database transaction
for the full stage. The live stage handler is still scheduled for M5-S9.

Inspect `filter_reason`, `filter_detail` and `opportunity_checks` to understand an
exclusion. No source/opportunity is deleted. Weak language evidence, spam warnings,
region/activity/relevance failures and unknown checks alone do not auto-filter.
Existing blocklist and skip-spam rules remain discovery-time decisions. The
migration also backfills readable explanations for previously filtered rows.

## M5-S7 explicit rescoring

On a completed or stopped job, a user with `jobs.rescore` confirms **Rescore**.
The request records the current scoring policy and activity weights. Keep the
worker running; its dedicated rescore loop runs even before S9 enables check
processing. Refresh the job page or inspect Activity for the final row count.
If checks are still running, let them release their claims before retrying.

A worker disconnect leaves the request pending and all old scores intact. Another
worker retries automatically. A failed request (`invalid_scoring_data`) means
invalid configuration or stored evidence; inspect the `rescore_failed` worker log,
correct the underlying configuration/data, and explicitly request another rescore.
Do not change its captured snapshot or mark a request done manually. Neither a
settings edit nor worker restart automatically requests rescoring.

Global thresholds/boost constants live in `scoring_policy.config`; validate proposed
JSON with `ScoringConfig.model_validate` and increment its version before applying
an operator change. Activity weights remain in the activity editor. New job history
snapshots pin settings; old immutable snapshots fall back to packaged v1 policy.
See ADR 0022 for formulas, exclusions and atomicity. Rescoring updates scores,
tiers, explanations, normal update timestamps and derived tier counters only.
It never reorders queues or changes review decisions. Queue assignment is S8;
full live check/score orchestration is S9; calibration is S10.

## M5-S8 review queue

After score publication, call `worker_assign_opportunity_queue` in the same
transaction to assign Ready/Backlog and release the check claim. Do not write
`queue_group` or `first_ready_rank` directly. The function holds a short per-job
lock, checks the claim owner/attempt/config/lease and saved checks, and preserves
existing membership on retry. A stale claim must be discarded.

Undecided Ready rows are capped by `jobs.review_queue_size` (default 50). New results go to
Backlog after the pending window fills, even if their score is higher; shown rows are
never evicted. Backlog release is an authenticated operation requiring
`results.view` and `results.release_batch`; the default is 25, and SQL limits it
to currently free slots. Ordering is verified tier, score, overlap, discovery
time, then UUID. Unchecked is eligible but last. Successful batches add a
`backlog_released` activity event. Approved, Rejected, and Used rows free a
pending slot without losing Ready history. Reopening a Ready decision requires
a free slot. The job Overview and Results tabs show pending progress, total
Ready, and Backlog counts and expose release to authorized reviewers. Automatic
top-up is off.
