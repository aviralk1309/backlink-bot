# Testing

| What | Command | Needs | Touches data |
|---|---|---|---|
| Lint, types, unit tests (web and worker) | `make check` | nothing running | no |
| Unit tests only (worker) | `cd apps/worker && uv run pytest -m unit` | nothing running | no |
| Integration tests (worker) | `cd apps/worker && uv run pytest -m integration` | local Supabase with worker role | yes |
| SQL tests (RLS, guards, functions) | `make db-verify` | `make db-start` | **wipes the local database first** |
| Review capture audit | `psql "$AUDIT_DATABASE_URL" -X -f scripts/audit-review-capture.sql` | PostgreSQL URL for a role with full opportunity and review-history visibility | no |
| End-to-end (browser) | `make e2e` | `make db-start`, `apps/web/.env.local` pointing at local Supabase | creates `e2e-*` users and roles |

Stop the live worker before worker integration tests. These tests create Running
jobs in the local database; another worker can claim them and call the paid
search provider instead of the test's fake provider.

## SQL tests need a pristine database

The pgTAP files assume the freshly migrated state: no users, three starter
roles, seeded grants. `001_pristine.test.sql` checks this and says so when it
fails. Use `make db-verify`, which resets and then tests. Bare `make db-test`
on a database you have been using fails for that reason, not because of a bug.

After `make db-verify` the local database has no users. Recreate your Admin:

    cd apps/web
    BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='...' \
      pnpm bootstrap:admin --confirm-url <NEXT_PUBLIC_SUPABASE_URL>

## End-to-end tests

- Run against local Supabase only. `e2e/support/env.ts` refuses any other host.
- `e2e/support/seed.ts` creates `e2e-admin@example.com` and
  `e2e-user@example.com` (Viewer) with a fixed local-only password, and
  removes leftover `e2e-role-*` roles. It does not touch your own account.
- First run: `pnpm exec playwright install chromium`; install worker dependencies
  with `cd apps/worker && uv sync`.
- Playwright builds production code and owns a server on `localhost:3100`.
  It refuses an existing server rather than silently reusing a stale development
  process. Traces and screenshots are retained on failure; login failures include
  browser errors and failed request paths. Keep port 3100 free.
- The CSV lifecycle requires an idle local worker queue and local Storage. It
  invokes `scripts/e2e_ingestion.py` through `uv`, using the `worker` database
  role (default local connection; override `E2E_WORKER_DATABASE_URL` if needed).
  It inherits Storage credentials from the browser test environment. Do not run
  another worker or worker integration tests concurrently with this suite.
  The driver refuses nonlocal endpoints, non-worker DB credentials, non-E2E
  jobs and other eligible queue entries.
- Specs run in order, one worker, because they share the database:
  - `authorization.spec.ts`: role gates, route protection, unauthorized redirects.
  - `csv-mapping.spec.ts`: upload, mapping and template persistence; real Storage
    download, CSV validation, duplicate handling, report upload/download, browser
    confirmation, gap preview and atomic worker pickup into opportunities.
    Staging rows and Ready status are no longer fabricated by the test. Fixture
    Storage objects and jobs are cleaned after each test.
  - `health.spec.ts`: system health check endpoint.
  - `jobs.spec.ts`: draft creation, setting updates, state machine, viewer restrictions, activities, and blocklist management.
  - `results-review.spec.ts`: review decisions, job and overall reports, CSV export, and Viewer report access.
  - `role-builder.spec.ts`: custom role creation, assignment, permission limits, and deletion.
  - `ux-responsive.spec.ts`: mobile navigation, responsive layouts, theme switching, and chips input.

## Adding tests

- New table or policy: add pgTAP in `supabase/tests/database/` and update the
  counts in `001_pristine.test.sql` if the seed changes.
- New permission: update the catalog and role-mapping assertions in
  `010_identity.test.sql` and the grant count in `001_pristine.test.sql`.
- Pure rules: Vitest next to the code. Server actions and pages are covered by
  Playwright, not Vitest.

## Worker integration tests

M8-S3: `apps/worker/tests/unit/test_query_plan.py` covers template expansion,
diversity, deduplication and budget caps. `test_query_generation.py` covers
atomic pickup, counters and worker RLS. Database test
`108_m8_query_plan.test.sql` checks the query schema and completion gate.
M8-S4: `apps/worker/tests/integration/test_search_runner.py` uses fake Serper
responses and real worker-role Postgres to check claimed pages, source dedupe,
blocklists, credits, domain yield, worker races and expired-lease retries.
`109_m8_search_executor.test.sql` checks write permissions.
M8-S5: the same search integration suite covers two concurrent paid calls,
reported two-credit responses, adaptive reservations, remaining checks and
`budget_reached` completion. `110_m8_budget_enforcement.test.sql` checks the
shared claim limit, permissions, completion gate and all-query failure rule.
The search integration suite also races publication of a zero-result paid call
against another claim to check the shared job lock.
M8-S6: `111_m8_saturation.test.sql` covers minimum sample, strict threshold,
failed-query exclusion, zero threshold, CSV exclusion, and the N-call Resume
checkpoint. The search integration suite proves automatic pause, blocked new
claims, re-evaluation after Resume, and budget completion priority.
It also proves opportunity checks remain claimable while Saturated.

Integration tests for MVP 3 and beyond require a running Supabase instance with
the worker role configured. They test:

- **Concurrency**: Multiple workers claiming and processing rows simultaneously
- **Lease management**: Lease extension, expiry, and reaping
- **Deduplication**: Race conditions when multiple workers discover the same URL
- **Job lifecycle**: State transitions, completion detection
- **Counters**: Transactional updates, consistency
- **Atomic import**: Pickup plus gap/seed import, two-runner exclusion,
  cancellation and backend-termination recovery, transient retry, failure
  reasons, and Pause/Stop serialization (`test_job_runner.py`). These tests
  terminate only their own captured worker connection. Run against a local
  test database with no unrelated queued/running jobs.
- **CSV recovery**: `test_csv_runner.py` covers exclusive/expired claims,
  fencing, retry exhaustion, renewal, cancellation, timeout and database
  termination while staging. It uses fake Storage and removes its fixture jobs.
  `088_csv_claim_recovery.test.sql` verifies claim permissions and transitions.

Environment variables:
- `TEST_WORKER_DATABASE_URL`: Connection string for worker role (default: `postgresql://worker:worker@127.0.0.1:54322/postgres`)
- `TEST_ADMIN_DATABASE_URL`: Connection string for admin role (default: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`)

Run with:
```bash
# Start local Supabase first
make db-start

# Run all worker tests
cd apps/worker && uv run pytest

# Run only integration tests
cd apps/worker && uv run pytest -m integration

# Run with verbose output
cd apps/worker && uv run pytest -m integration -v
```

## URL normalization test vectors

The shared test vectors in `fixtures/url-normalization.json` must pass for both
Python (pytest) and TypeScript (vitest). Changes to normalization rules require
updating this file. The format:

```json
{
  "url_vectors": [
    {"input": "...", "normalized": "...", "host": "...", "registered_domain": "..."},
    {"input": "...", "error": "empty"}
  ],
  "domain_vectors": [
    {"input": "...", "domain": "..."}
  ]
}
```

### CSV validation/staging memory benchmark

From `apps/worker`, with local Supabase running and no competing mapped uploads:

```sh
uv run python scripts/benchmark_csv_memory.py --rows 50000 --kind unique
uv run python scripts/benchmark_csv_memory.py --rows 250000 --kind unique
uv run python scripts/benchmark_csv_memory.py --rows 50000 --kind invalid
uv run python scripts/benchmark_csv_memory.py --rows 250000 --kind invalid
```

Each fresh process generates a CSV on disk, executes the real CSV runner and
PostgreSQL staging, verifies Ready/counts, prints peak process RSS and deletes its
fixture job. Storage is a chunked local fixture, not the live Storage API. Override
`TEST_WORKER_DATABASE_URL` / `TEST_ADMIN_DATABASE_URL` for a disposable test DB.
Use a local test environment without concurrent CSV processing; the runner uses
the ordinary claim queue. Temp disk and database storage must accommodate the
input, duplicate index, staging and error report. Compare RSS across sizes rather
than assuming a machine-independent absolute threshold. ADR 0017 records the
resource contract; the readiness review records measured results.


### M5-S2 robots and cache verification

- `cd apps/worker && uv run pytest tests/unit/test_robots.py`: rules, origin
  identity, redirect/SSRF guards, response limits, unknown outcomes and cooldowns.
- `cd apps/worker && uv run pytest tests/integration/test_robots_cache.py`:
  real worker-role connections, concurrent refresh, expiry and stale-owner fencing,
  origin cooldowns, seven-day facts and moderation preservation.
- `supabase test db supabase/tests/database/090_origin_robots_cache.test.sql`:
  12 assertions for RLS, role grants, lease ownership and bounds.

The complete SQL suite expects a pristine database. On a populated development
instance, user-count/last-admin assertions and query-plan assertions may fail;
use a dedicated clean test instance for that gate rather than resetting user data.


### M5-S3 check framework

See [check framework](check-framework.md) for extension and persistence contracts.
`tests/unit/test_check_framework.py` verifies ordered execution, dead-page
short-circuiting, reason templates and bounded JSON. The real PostgreSQL
`tests/integration/test_check_store.py` verifies atomic replacement, claim fencing,
and rollback. `091_check_framework.test.sql` verifies RPC/table permissions and
input bounds. `tests/integration/test_opportunity_pipeline.py` exercises the
composed S9 worker handler end to end.


### M5-S4 free checks

`tests/unit/test_free_checks.py` exercises the complete registry against 15 labelled
synthetic HTML fixtures and targeted policy boundaries. The S3 persistence suite
also stores all eight real S4 results atomically. Fetcher tests verify repeated
X-Robots-Tag headers retain independent scopes. `scripts/benchmark_languages.py`
compares detector candidates in fresh processes; see ADR 0019 for measured results.
The separate M5-S10 synthetic corpus and ranking calibration are documented below.


### M5-S5 domain admission

`tests/integration/test_domain_caps.py` uses real PostgreSQL and four engines to
prove exactly ten full pipelines run for 50 same-domain URLs. It also covers
ranking, retries, rollback, isolation, late discoveries, overrides and bounded
skipping. The existing job-engine fixture uses cap 1000 to keep its bulk lease
mechanics independent of the ten-URL production default.

`073_m3_job_engine.test.sql` and `092_domain_check_caps.test.sql` together cover
58 assertions for claims/leases, access control, cap transitions, counters and
frozen profile overrides. No database reset is needed for these focused suites.


### M5-S6 auto-filter rules

`tests/unit/test_auto_filter.py` tests the allowlist, unknown/weak outcomes,
confidence floors and actual S4 outputs. `tests/integration/test_check_store.py`
adds real database publication, no-deletion, stale-attempt, replay and rollback
coverage. `093_auto_filter.test.sql` checks readable discovery reasons, prior-spam
skip behavior, atomic evidence validation, counters and API-role denial. Run it
alongside the existing `072_m3_discovery_flags.test.sql` regression suite.

### M5-S7 scoring and explicit rescore

- `tests/unit/test_scoring.py` with `tests/fixtures/scoring/golden.json`: exact
  Decimal points/tiers/reasons, input-order independence, gap/search parity,
  diminishing boosts, spam, caps, uncertainty, profile overrides and versioning.
- `tests/integration/test_rescore.py`: real worker privileges, changed weights,
  capture-at-confirmation, duplicate requests, whole-job rollback, filtered/duplicate
  exclusion, raw evidence preservation, competing workers and crash retry.
- S7 cases in `test_check_store.py`: initial score claim fencing and atomic rollback
  with the raw-check transaction.
- `supabase/tests/database/094_scoring.test.sql`: 25 permission, confirmation,
  snapshot and lifecycle assertions, rolled back without resetting local data.
- `src/features/jobs/rescore-action.test.ts`: server-action authorization,
  confirmation, validation and DB idle guard. The latest result appears on the
  job page; the Activity tab reports asynchronous completion/failure.

### M5-S8/9 queue and pipeline E2E

`tests/integration/test_opportunity_pipeline.py` creates gap rows through
`record_discovery`, then runs them through the real Postgres claim engine and
`OpportunityHandler`. It verifies all nine checks, filter evidence, score order,
two Ready rows, one Backlog row, one Auto-filtered row, exact job counters and
lease release. Only outbound HTTP is replaced by saved fixture responses. Run it
against local Supabase with an idle worker queue:

```sh
uv run pytest tests/integration/test_opportunity_pipeline.py -q
```

### M5-S10 offline calibration

`tests/fixtures/calibration.csv` labels 40 local HTML pages. The CLI runs the
production check registry, auto-filter selection and scorer without network
access:

```sh
uv run python scripts/calibrate_checks.py
```

The committed synthetic corpus currently reports precision@50 of 0.739 across
17 relevant rows out of 23 ranked rows. This is regression evidence only; real
calibration needs the 100–200 product-labeled URLs from M5-PM2.

### M5-S11 worker suite

The full worker suite is split into offline unit tests and local-Postgres
integration tests:

```sh
uv run pytest -m unit
uv run pytest -m integration
```

At M5 completion, these gates passed with 775 unit tests and 71 integration tests.

### M6-S8 review and export

`supabase/tests/database/098_m6_review_actions.test.sql`,
`099_m6_reject_scope_effects.test.sql`, and `104_m6_results_export.test.sql`
cover transitions, rejection rules and scope, role gates, stale-version conflicts,
and export permissions. They passed 78 assertions without resetting local data.
The existing M6 schema, Results, detail, queue, and export tests remain in the
full `make db-verify` gate (which resets local data).

`apps/web/e2e/results-review.spec.ts` creates two disposable Ready results and
uses the browser to claim, approve, reject with a reason, download CSV, and check
the export audit event and Viewer restrictions. Run it with local Supabase:

```sh
cd apps/web
pnpm e2e e2e/results-review.spec.ts
```

In S8, the real CSV download was imported by LibreOffice as two rows; the
`=1+1` note was text and the workbook contained no formula cells. The browser
scenario passed with a temporary style shim on a webpack build because this
sandbox cannot run the configured Turbopack build. Run the normal E2E command
in an environment that permits Turbopack's internal port binding.
