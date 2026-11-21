# Backend and API audit

## Executive summary
1. The backend is an internal job pipeline: Postgres owns durable state, Python does ingestion/search/fetch/check/score work, and Next.js handles user commands and downloads.
2. The main opportunity publication path has a live lease fence and commits checks, score, and queue assignment together (`apps/worker/src/worker/stages/opportunity.py:144-191`).
3. Fetch SSRF controls include IP-range rejection, redirect checks, and socket-level DNS pinning; the shared domain delay is coordinated in Postgres (`apps/worker/src/worker/fetch/ssrf.py:49-86,135-183`; `apps/worker/src/worker/fetch/transport.py:25-54`; `supabase/migrations/20261025030000_fetch_rate_limits.sql:9-36`).
4. **BLOCKER:** CSV error downloads can put unescaped attacker-controlled formula cells into a spreadsheet (B-01).
5. **HIGH:** CSV staging and rescoring hold long database transactions and row locks across large jobs (B-02, B-03).
6. **HIGH:** A charged Serper call can be replayed after a crash or lease loss, outside the reported-credit budget (B-04; see P-04).
7. **HIGH:** Provider outages are retried without a durable cool-off, and unexpected fetcher errors are recorded as site outcomes (B-05, B-07).
8. **HIGH:** The CSV error-download fallback can silently omit rows and the primary path buffers the whole report (B-06).
9. **MEDIUM:** Opportunity retry handling has no delayed retry or operator dead-letter workflow; query preview logic is duplicated across runtimes (B-08, B-09).
10. Findings: **1 BLOCKER, 6 HIGH, 3 MEDIUM, 0 LOW**; the expensive HTTP surfaces have no application-level request throttle (B-10).

## Actual backend boundaries and sources of truth

| Rule or operation | Source of truth today | Other layer and drift risk |
| --- | --- | --- |
| Job lifecycle and permission to act | Postgres transition/RLS functions; Next actions call them under the user session (`supabase/migrations/20261010182546_m2_job_lifecycle.sql:219-345`; `apps/web/src/features/jobs/actions.ts:63-80`; `apps/worker/src/worker/engine/runner.py:29-68`) | Next duplicates editable/action guards for immediate UX (`apps/web/src/features/jobs/actions.ts:97-104`); database still has to reject direct RPC calls. |
| CSV upload admission and row interpretation | Storage bucket cap and worker validation/staging (`supabase/migrations/20261015025911_m4_csv_storage.sql:22-26`; `apps/worker/src/worker/io/csv_validator.py:233-310`) | Next duplicates 100 MiB/2M limits for the form (`apps/web/src/features/csv/limits.ts:1-10`); config can drift. |
| Gap domains | `get_job_gap_domains` SQL used by worker (`apps/worker/src/worker/engine/gap.py:127-145`; `supabase/migrations/20261023030000_m4_gap_calculation.sql:18-125`) | Python `calculate_domain_gap` is only called by tests, so its unit tests do not prove production SQL behavior (`apps/worker/src/worker/engine/gap.py:56-124`; `rg -n 'calculate_domain_gap\(' apps/worker`). See B-09. |
| Search query plan and credit admission | Python builds the plan; Postgres serializes per-job credit claims and publication (`apps/worker/src/worker/engine/queries.py:89-118`; `supabase/migrations/20261031020000_m8_saturation.sql:74-128`; `apps/worker/src/worker/engine/search.py:235-245`) | Browser preview is a separate TypeScript implementation (`apps/web/src/features/jobs/query-preview.ts:4-6,71-75`). See B-09. |
| URL fetch and site checks | Python fetcher and check registry; socket transport enforces public destinations (`apps/worker/src/worker/fetch/fetcher.py:152-234`; `apps/worker/src/worker/checks/core.py:15-48`) | Expected site failures become evidence; B-07 shows the unexpected-error boundary is too wide. |
| Opportunity claims, caps, publication | Postgres locks/admissions/lease fence; Python computes checks and score (`supabase/migrations/20261026030000_m5_domain_check_caps.sql:80-150`; `supabase/migrations/20261027070000_m5_pipeline_publication.sql:23-43`; `apps/worker/src/worker/stages/opportunity.py:144-191`) | The domain-facts cache is written before the publication fence, but no user-visible score/check is committed there (`apps/worker/src/worker/stages/opportunity.py:120-143`). |
| Exports | Results: Postgres keyset batches plus a Next `ReadableStream`; report: four SQL aggregates then one buffered CSV (`apps/web/src/app/api/jobs/[id]/results/export/route.ts:59-65,105-130`; `apps/web/src/app/api/reports/export/route.ts:26-35`) | Main results/report CSVs use `csvCell`; error-report paths do not. See B-01 and B-06. |

ADR 0002's Postgres queue choice is implemented. ADR 0003's direct psycopg worker connection is implemented. ADR 0024's transaction and fence hold for visible opportunity publication (`docs/adr/0024-claim-fenced-opportunity-pipeline.md:7-36`; `apps/worker/src/worker/stages/opportunity.py:144-191`). Its “immutable” activity-profile promise is only conditional for pre-S9 job history: those rows read current profiles (`apps/worker/src/worker/stages/opportunity.py:58-73`), so replaying an old job after a profile edit can change check semantics. That legacy exception should be stated in the ADR or migrated to frozen profiles.

## Queue and crash audit

| Stage | Claim, lease, and duplicate behavior | Retry/terminal behavior |
| --- | --- | --- |
| Opportunity checks | Job/domain admission and row locks, attempt increment, renewable lease; publication fences worker, attempt, config version, and live expiry (`supabase/migrations/20261026030000_m5_domain_check_caps.sql:80-144`; `supabase/migrations/20261027070000_m5_pipeline_publication.sql:25-38`; `apps/worker/src/worker/engine/loop.py:152-170`). A killed worker can cause a second fetch, but stale visible publication is rejected. | Reaper returns expired work to `pending`, then `failed` at max attempts; immediate retry and no separate dead-letter queue (`supabase/migrations/20261013164139_m3_job_engine.sql:187-216`). See B-08. |
| Search | Two slots per process; SQL caps two active claims per job and locks the job across claim/publication (`apps/worker/src/worker/engine/search.py:105-109,123-156,235-245`; `supabase/migrations/20261031020000_m8_saturation.sql:95-125`). Duplicate discovery writes are committed with query completion (`apps/worker/src/worker/engine/search.py:235-335`). | Provider timeout/invalid response reserves uncertain spend and fails without automatic retry; 429/5xx goes back to pending, and a crash can replay a charged call (`apps/worker/src/worker/engine/search.py:176-233`; `docs/runbooks/worker.md:132-155`). See B-04/B-05. |
| CSV | Claim token and lease; staging locks the upload row and replaces prior staged rows in one transaction (`supabase/migrations/20261025020000_csv_claim_recovery.sql:49-93`; `apps/worker/src/worker/engine/csv_runner.py:190-224`; `apps/worker/src/worker/io/csv_validator.py:245-250`). | Reaper retries expired claims to max attempts (`supabase/migrations/20261025020000_csv_claim_recovery.sql:18-45`). Download heartbeats, staging does not; B-02 covers the long locked transaction. |
| Rescore | SQL locks pending request and job; one transaction covers every score and request completion, so a crash rolls back the whole job (`supabase/migrations/20261027020000_m5_scoring.sql:98-105`; `apps/worker/src/worker/scoring/rescore.py:19-101`). | Invalid stored data marks request failed; transient DB errors retry. B-03 covers large jobs. |
| Link verification | One live placement claimed with 60-second lease, attempt fenced on finish (`apps/worker/src/worker/engine/link_verifier.py:38-68`; `supabase/migrations/20261104050000_link_placements.sql:130-183`). | After three expired attempts SQL records `unknown` and schedules the next daily check (`supabase/migrations/20261104050000_link_placements.sql:137-151`). |

Worker shutdown stops claims, waits up to 30 seconds for opportunity handlers, cancels the remainder, then releases owned opportunity claims (`apps/worker/src/worker/engine/loop.py:76-91,184-193`). Search and CSV rely on their lease recovery; the top-level worker awaits all runner tasks after SIGTERM (`apps/worker/src/worker/main.py:98-115`). A process killed during a provider call has no way to learn whether that call was charged (B-04).

Each process shares a pool of at most ten connections by default across opportunity, CSV, rescore, job, cleanup, optional search, and optional verifier runners (`apps/worker/src/worker/config/settings.py:25-44`; `apps/worker/src/worker/main.py:45-94`; `apps/worker/src/worker/db/pool.py:7-14`). Opportunity claim admission serializes on a job row and may inspect up to 1,000 pending rows per call before releasing that lock (`supabase/migrations/20261026030000_m5_domain_check_caps.sql:80-90,99-150`). The long CSV/rescore transactions in B-02/B-03 are the more direct pool and lock risks. There is no measured replica/pool sizing evidence in the repository.

Fetcher boundary checks are materially implemented: URL preflight rejects non-HTTP schemes, non-80/443 ports, and private/reserved IPv4/IPv6 destinations; every redirect re-enters validation, and the socket backend resolves and pins the actual connection address, including on retries (`apps/worker/src/worker/fetch/ssrf.py:11-86,135-183`; `apps/worker/src/worker/fetch/fetcher.py:189-200,256-294`; `apps/worker/src/worker/fetch/transport.py:25-54`; `apps/worker/tests/unit/test_fetch_transport.py:101-121`). Decimal/octal host spellings go through `getaddrinfo` and the returned address check rather than a string-only denylist (`apps/worker/src/worker/fetch/ssrf.py:103-132,168-181`), but I did not find a dedicated unusual-notation regression test. HTML is required before reading a normal page; accumulated decoded response bytes are capped at 2 MiB (robots at 512 KiB), and an unavailable robots policy fails closed (`apps/worker/src/worker/fetch/fetcher.py:355-398`; `apps/worker/src/worker/fetch/robots.py:115-143`). The shared Postgres dispatch slot covers retries and redirects (`apps/worker/src/worker/fetch/fetcher.py:225-245`; `apps/worker/src/worker/fetch/rate_limiter.py:73-104`).

CSV input is capped at 100 MiB in Storage and two million records in the worker; parsing streams rows, flushes 1,000-row batches, and keeps duplicate detection on disk (`supabase/migrations/20261015025911_m4_csv_storage.sql:22-26`; `apps/worker/src/worker/config/settings.py:19-22`; `apps/worker/src/worker/io/csv_validator.py:28-29,252-295`). Encoding and delimiter detection sample the start of the file, so a misleading preamble or later bad bytes remain heuristic edge cases; the reader replaces decoding errors and the parser has a 131,072-character field limit (`apps/worker/src/worker/io/csv_encoding.py:12-17,159-162`; `apps/worker/src/worker/io/csv_delimiter.py:12-16,52-64`; `apps/worker/src/worker/io/csv_reader.py:13-18,73-99`). B-01/B-06 concern the *error export*, not the bounded input loop.

## HTTP and validation surface

| Endpoint | Gate and shape | Bound/operational note |
| --- | --- | --- |
| `GET /api/health` | Public `{status:"ok"}` (`apps/web/src/app/api/health/route.ts:1-3`) | Process liveness only; it does not check DB, worker, or provider readiness. |
| `GET /api/system/workers` | `system.view_health`; JSON (`apps/web/src/app/api/system/workers/route.ts:8-25`) | No-store; returns a structured error. |
| `GET /jobs/[id]/stats` | User-session RLS; JSON or 404 (`apps/web/src/app/(app)/jobs/[id]/stats/route.ts:7-34`; `apps/web/src/features/jobs/queries.ts:177-201`) | Polled every 5 seconds (`apps/web/src/features/jobs/stats.ts:4`). |
| `POST /api/jobs/[id]/results/export` | Same-origin check, three permissions, validated form and ID (`apps/web/src/app/api/jobs/[id]/results/export/route.ts:13-43`) | Keyset batches of 500 and streamed CSV (`apps/web/src/app/api/jobs/[id]/results/export/route.ts:45-65,105-130`); no row-count cap or request throttle. |
| `GET /api/jobs/[id]/uploads/[uploadId]/errors` | `csv.upload` plus user-session Storage/RLS (`apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:6-31`) | Download buffers Storage Blob; fallback has no explicit page loop or formula escaping (`apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:35-74`). See B-01/B-06. |
| `GET /api/reports/export` | `reports.view`; filter parser (`apps/web/src/app/api/reports/export/route.ts:6-24`) | Buffers four aggregates into one CSV (`apps/web/src/app/api/reports/export/route.ts:26-35`); no request throttle. |

Server actions use permission checks and primarily Zod schemas, but validation is not uniformly Zod: result actions validate selected fields manually (`apps/web/src/features/results/actions.ts:83-201`). SQL constraints/RLS remain the trust boundary. The routes mix plain-text and JSON error bodies and have no versioned/public OpenAPI contract (`apps/web/src/app/api/system/workers/route.ts:15-25`; `apps/web/src/app/api/jobs/[id]/results/export/route.ts:17-43`). That is tolerable only while this remains an internal UI backend. The worker has Ruff and strict mypy configured, and meaningful integration tests cover lease recovery, publication locking, and uncertain search spend (`apps/worker/pyproject.toml:39-56`; `apps/worker/tests/integration/test_job_engine.py:182-233`; `apps/worker/tests/integration/test_search_runner.py:422-484,650-684`). The CSV error-report test checks presence of rows, not formula safety (`apps/worker/tests/unit/test_csv_validator.py:175-180`).

## Findings

### [B-01] CSV error reports allow spreadsheet formula injection
- Severity: BLOCKER
- Type: RISK
- Area: Security
- Evidence: `apps/worker/src/worker/io/csv_validator.py:262-284`; `apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:63-69`; `apps/web/src/features/results/export.ts:122-129`; `apps/worker/tests/unit/test_csv_validator.py:175-180`.
- Why it matters: A malicious CSV can put `=`, `+`, `-`, or `@` at the start of an invalid `raw_url`. Both the stored error report and fallback download retain that value as a spreadsheet formula, even when the field is quoted; a reviewer opening the report may execute attacker-controlled spreadsheet content.
- Recommendation: Escape dangerous leading cells in the Python error writer and the TypeScript fallback using the main export's `csvCell` policy; add a round-trip test for both download paths. Effort S.
- Confidence: High

### [B-02] CSV staging holds a transaction across up to two million rows and a Storage upload
- Severity: HIGH
- Type: RISK
- Area: DB
- Evidence: `apps/worker/src/worker/config/settings.py:19-22`; `apps/worker/src/worker/engine/csv_runner.py:190-216`; `apps/worker/src/worker/io/csv_validator.py:245-310`; `supabase/migrations/20261025020000_csv_claim_recovery.sql:28-45`.
- Why it matters: The upload row is locked before parsing, and the transaction remains open through batched inserts and an external error-report upload. A large or slow file can hold locks and one pool connection for minutes; reapers skip the locked row, and database vacuum/WAL pressure grows with the transaction.
- Recommendation: Stage rows under a claim-scoped generation in bounded transactions, upload the report outside DB transactions, then atomically swap the active generation and finish the upload under the token fence. Effort L.
- Confidence: High

### [B-03] Rescoring every opportunity in one transaction will stall large jobs
- Severity: HIGH
- Type: RISK
- Area: DB
- Evidence: `apps/worker/src/worker/scoring/rescore.py:19-66,69-101`; `supabase/migrations/20261027020000_m5_scoring.sql:98-105`; `apps/worker/src/worker/config/settings.py:31`.
- Why it matters: The worker locks the job/request, then locks and updates every eligible opportunity in 500-row reads without committing. A large job can monopolize a pool connection, hold many row locks, delay job operations, and roll back all progress on any late failure.
- Recommendation: Use versioned score generations with bounded batch commits and an atomic final promotion, or impose an enforced job-size cap until that exists. Effort L.
- Confidence: High

### [B-04] A crash can replay a charged Serper request
- Severity: HIGH
- Type: RISK
- Area: Reliability
- Evidence: `apps/worker/src/worker/engine/search.py:123-156,235-245,296-335`; `apps/worker/src/worker/engine/search.py:66-82`; `docs/runbooks/worker.md:132-155`; `supabase/migrations/20261031020000_m8_saturation.sql:106-124`.
- Why it matters: Race: worker A receives a paid Serper response, then dies before its result transaction commits. The lease expires, worker B claims the same query and calls Serper again. Postgres fences duplicate *publication*, but cannot undo or reliably count the first charge; the local budget may understate actual spend. P-04 covers the separate missing account-wide ceiling.
- Recommendation: Before enabling paid search broadly, reconcile provider usage against query IDs/attempts, record an external-call intent before dispatch, and require operator review for crash-expired in-flight queries unless the provider offers idempotency. Effort M.
- Confidence: High

### [B-05] Serper outages recycle queries without durable cool-off
- Severity: HIGH
- Type: RISK
- Area: Reliability
- Evidence: `apps/worker/src/worker/providers/serper.py:92-118`; `apps/worker/src/worker/engine/search.py:110-125,176-233`; `supabase/migrations/20261031020000_m8_saturation.sql:95-118`.
- Why it matters: The HTTP client adds jitter within one attempt, but a 429/5xx returns the query directly to `pending`; the next poll can reclaim it. Multiple jobs and replicas can exhaust three attempts during a short outage and amplify provider throttling. There is no persisted `next_attempt_at`, `Retry-After` handling, or provider-wide circuit breaker.
- Recommendation: Persist a delayed next-attempt time with exponential backoff and jitter, honor `Retry-After`, and pause new provider claims during sustained 429/5xx outages. Effort M.
- Confidence: High

### [B-06] CSV error downloads can be truncated or fully buffered
- Severity: HIGH
- Type: GAP
- Area: Backend/API
- Evidence: `apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:35-74`; `apps/worker/src/worker/io/csv_validator.py:265-286`; `apps/web/src/features/csv/limits.ts:9-10`; `supabase/config.toml:18` (`max_rows = 1000`).
- Why it matters: The normal path downloads the entire Storage object as a Blob in the web process. If that download fails, the fallback performs one unpaginated `csv_rows` query, then returns `200` as if complete; a large invalid file can produce a truncated report under PostgREST row limits or overload web memory.
- Recommendation: Stream the stored report through a bounded response; make the fallback explicitly paginate all error rows, or return a clear unavailable error rather than a partial success. Effort M.
- Confidence: High

### [B-07] Unexpected fetcher defects are published as target-site failures
- Severity: HIGH
- Type: RISK
- Area: Reliability
- Evidence: `apps/worker/src/worker/fetch/fetcher.py:503-511`; `apps/worker/src/worker/checks/core.py:27-48`; `apps/worker/src/worker/stages/opportunity.py:120-145,148-179`; `apps/worker/src/worker/engine/loop.py:126-134`.
- Why it matters: A broad `except Exception` converts programming or dependency faults inside the fetch loop to `http_5xx` without a status code. The check layer calls that `page_unavailable`, and the stage can publish a completed unchecked opportunity instead of letting the lease retry an infrastructure fault. This can silently bias a whole job after one regression.
- Recommendation: Catch only expected network/protocol exceptions as site outcomes; let unexpected exceptions propagate to the engine's logged lease retry path. Effort S.
- Confidence: High

### [B-08] Opportunity poison work has no delayed retry or operator queue
- Severity: MEDIUM
- Type: GAP
- Area: Reliability
- Evidence: `supabase/migrations/20261013164139_m3_job_engine.sql:187-216`; `supabase/migrations/20261026030000_m5_domain_check_caps.sql:99-120,139-147`; `apps/worker/src/worker/engine/loop.py:172-180`; `rg -n 'retry.*opportun|failed.*opportun|retry.*check' apps/web/src supabase/migrations` (no retry control found).
- Why it matters: A transient shared dependency fault can immediately cycle pending checks until the three-attempt ceiling and leave failed rows without a dedicated replay/reason triage path. The queue is crash recoverable, but its terminal state is not an operational dead-letter workflow.
- Recommendation: Add a persisted next-attempt time and an operator-visible failed-check replay action with cause and attempt history; prioritize this before high-volume runs. Effort M.
- Confidence: High

### [B-09] Query preview duplicates the production planner, while gap unit tests exercise unused code
- Severity: MEDIUM
- Type: RISK
- Area: Backend/API
- Evidence: `apps/web/src/features/jobs/query-preview.ts:4-6,27-35,71-75,152-179`; `apps/worker/src/worker/engine/queries.py:17-19,48-66,188-205`; `apps/worker/src/worker/engine/gap.py:56-124,127-145`; `apps/worker/tests/unit/test_gap.py:16-161`.
- Why it matters: The user sees a TypeScript query preview, but the worker builds the paid plan independently in Python. Even normalization already differs (`toLowerCase` versus `casefold`), and most gap unit tests assert a Python function that production does not call. UI previews and green tests can therefore disagree with real work.
- Recommendation: Add shared golden fixtures comparing preview and worker plans, and move gap behavior tests to the SQL function; remove the unused Python gap implementation once those tests cover it. Effort M.
- Confidence: High

### [B-10] Expensive authenticated HTTP routes have no request throttle
- Severity: MEDIUM
- Type: GAP
- Area: Backend/API
- Evidence: `apps/web/src/app/api/jobs/[id]/results/export/route.ts:13-43,59-65,105-130`; `apps/web/src/app/api/reports/export/route.ts:6-35`; `apps/web/src/app/(app)/jobs/[id]/stats/route.ts:7-34`; `rg -n 'rate.?limit|throttle' apps/web/src/app apps/web/src/lib` (no route throttle found).
- Why it matters: Permissions prevent anonymous access, but an authorized or compromised account can repeatedly start full exports and four-query reports, competing with worker SQL and consuming DB/egress capacity. Results export streams in batches, so its per-request cost grows with job size.
- Recommendation: Add a per-user concurrent-export limit and request budget at the route boundary; measure DB duration and bytes before choosing numeric limits. Effort M.
- Confidence: Medium

## Things I could not verify

- Live Postgres lock wait times, WAL/vacuum impact, pool saturation, provider charges, and deployed proxy/API rate limits are **UNVERIFIED**. Query logs, database metrics, provider invoices, and ingress configuration would settle them.
- A real 100 MiB CSV, multi-million-row rescore, multi-replica outage, and post-crash Serper charge were not executed. The transaction and race findings are inferred from the code paths cited above, not measured production incidents.
- Serper's current idempotency/usage reconciliation features and every target site's live response behavior are **UNVERIFIED** without provider contract access and controlled external tests.
- Peak decoder memory on adversarial compressed responses and unusual numeric host spellings are **UNVERIFIED** without focused runtime tests; the code checks decoded chunks after `httpx` yields them (`apps/worker/src/worker/fetch/fetcher.py:369-398`).

## Questions for the owner

- What is the maximum intended job size and concurrent worker replica count? Those numbers determine whether B-02/B-03 are release gates.
- Is paid search authorized for production users now, and is there a provider-side spend cap or charge reconciliation process for B-04/B-05?
- Is this API permanently private to the Next.js UI, or will external clients need a versioned error/OpenAPI contract?
- Who owns failed opportunity checks and incomplete CSV error reports, and what is the expected recovery time?
