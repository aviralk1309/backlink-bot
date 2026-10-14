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

## Worker engine

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

### Worker logs "no_stage_handler"

This is expected until M5 (free checks). The engine runs but does not claim
rows. Set a handler in `apps/worker/src/worker/main.py` to enable processing.

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
reaper returns the row to pending. To force immediate release:

```sql
-- Return all stale running rows to pending
update opportunities 
set check_status = 'pending', locked_by = null, lease_expires_at = null, attempts = attempts + 1
where check_status = 'running' and lease_expires_at < now();
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