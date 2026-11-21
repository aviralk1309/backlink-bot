# Infrastructure and reliability audit

## Executive summary
1. CI exists: it runs web lint, types, format, unit tests, build and dependency audit; worker lint, types, unit/integration tests and dependency audit; database replay/pgTAP; and Gitleaks (`.github/workflows/ci.yml:7-96`).
2. CI does not run the browser suite or build the proposed web image, although both exist locally (`.github/workflows/ci.yml:7-96`; `Makefile:35-36`; `apps/web/playwright.config.ts:3-19`).
3. The tracked Compose file is a local worker only; the web Dockerfile and entire VPS deployment are untracked working-tree drafts (`docker-compose.yml:1-9`; `git ls-files apps/web/Dockerfile deploy/production/compose.yaml` returned no paths).
4. There is no tracked CD, staging definition, immutable release artifact, or end-to-end deployment rollback (`.github/workflows/ci.yml:1-96`; `docs/adr/0011-local-first-hosting.md:1-5`; I-01).
5. The draft production update builds in place after `git pull`, while its first-install steps apply database migrations separately; neither path supplies a tested compatibility gate (`deploy/production/README.md:7-21,78-87`; I-01; D-03).
6. Worker logs are JSON with a worker ID and some job/task IDs, and the UI classifies heartbeats; no tracked alert route, dashboard, trace pipeline, or SLO turns those signals into on-call action (`apps/worker/src/worker/logging.py:6-16`; `apps/worker/src/worker/main.py:35-38`; `docs/runbooks/worker.md:166-189`; I-03).
7. The public web health endpoint always returns `ok`, even when the database, Storage, or worker is unavailable (`apps/web/src/app/api/health/route.ts:1-3`; I-03).
8. The stuck-row runbook recommends an update that bypasses the bounded SQL reaper and increments attempts itself; its `no_stage_handler` explanation is obsolete (`docs/runbooks/worker.md:256-281`; `supabase/migrations/20261013164139_m3_job_engine.sql:187-216`; I-04).
9. At the draft production setting of two check slots, 1,000 checks each consuming the 15-second fetch deadline would need at least about 2.1 hours before retries or database time; actual throughput and cost are unmeasured (`deploy/production/compose.yaml:43-46`; `apps/worker/src/worker/config/settings.py:24-42`; I-07).
10. Findings: **1 BLOCKER, 4 HIGH, 3 MEDIUM, 0 LOW**. Database restore risk is already recorded as D-04; paid-search overspend as P-04/B-04; million-row queue/report costs as D-01/D-02.

## Current operating model and release gates

The accepted hosting decision is local worker operation with hosting deferred (`docs/adr/0011-local-first-hosting.md:1-5`). The tracked `docker-compose.yml` runs only that worker against local Supabase using `host.docker.internal` (`docker-compose.yml:1-9`). The untracked `deploy/production/` draft instead proposes one VPS for web, worker, and Cloudflare Tunnel, with Supabase Cloud for database, Auth, and Storage (`deploy/production/README.md:1-5`; `deploy/production/compose.yaml:3-64`). `docker compose --env-file production.env.example -f compose.yaml config --quiet` succeeded in that directory; this proves syntax/interpolation only, not a working release. The web Dockerfile and `output: "standalone"` change are also untracked/uncommitted (`git status --short`; `apps/web/Dockerfile:1-29`; `apps/web/next.config.ts:3-6`). There is no evidence here that the draft has ever been deployed.

Minimum release pipeline: gate a pull request on existing checks plus local-Supabase Playwright tests and both image builds; pin the Supabase CLI version and image bases; publish images tagged by commit digest; deploy that digest to a separate staging project; rehearse pending migrations against a recent sanitized copy with lock/time checks; require a reviewed production promotion; run migrations in an expand/contract order before or after compatible app versions as appropriate; smoke-test health **and** a real database-backed job; retain the prior image digest and documented rollback/forward-fix procedure. The PR must record which migrations cannot be reversed. This is a proposed gate, not a claim that the current system has one.

## Failure behavior observed in code

| Dependency/failure | Current behavior | Operational hole |
|---|---|---|
| Database unavailable | Worker startup fails at `select 1`; running loops log claim, reaper, and heartbeat failures (`apps/worker/src/worker/main.py:45-48`; `apps/worker/src/worker/engine/loop.py:95-115,172-180`; `apps/worker/src/worker/engine/heartbeat.py:54-64`). | `/api/health` still says `ok`; there is no DB outage alert or tested restore (I-03; D-04). |
| Serper unavailable | HTTP 429/5xx/network failures get up to three per-call attempts, then the search runner handles a provider failure (`apps/worker/src/worker/providers/serper.py:92-118`; `apps/worker/src/worker/engine/search.py:123-138`). | No durable provider-wide cool-off or account spend alarm; see B-05, B-04, P-04. |
| Storage unavailable | CSV processing has a bounded attempt/deadline; deletion cleanup retains its queue row when the HTTP call fails (`docs/runbooks/worker.md:81-101`; `apps/worker/src/worker/engine/storage_cleanup.py:21-55`). | No alert on failed uploads or accumulated cleanup rows (I-03/I-05). |
| Worker unavailable | Existing opportunity claims expire and another running worker's reaper can return them; a sole dead worker has no reaper and queued jobs wait (`apps/worker/src/worker/engine/loop.py:172-180`; `supabase/migrations/20261013164139_m3_job_engine.sql:164-216`). | Dashboard heartbeat polling requires a human to look; no page for zero workers with pending work (I-03). |
| VPS/tunnel unavailable | Draft stack puts all three containers on one host and restarts them unless stopped (`deploy/production/README.md:1-5`; `deploy/production/compose.yaml:35-64`). | No alternate host, failover drill, or recovery time objective (I-05). |

## Provisional service objectives and capacity model

These are **proposals to validate against pilot traffic**, not existing guarantees. Measure (1) p95 time from job `Running` to terminal status for jobs with at most 1,000 eligible URLs, target under four hours; (2) share of unpaused jobs that reach a terminal status without infrastructure failure within 24 hours, target 99%; (3) p95 age of a newly discovered opportunity before check/scoring publication, target under six hours. Page when no heartbeat is fresh for 60 seconds **and** claimable work exists, when the oldest claimable row is over 15 minutes old, or when infrastructure failures exceed 5% of attempts over 15 minutes. Use a separate warning for paid-search uncertain spend and a hard account-level credit budget. Record definitions and exclusions before promising these externally.

At the checked defaults, each worker may have four check handlers and ten pooled database connections; N replicas can request up to `10N` worker connections before web or maintenance connections (`apps/worker/src/worker/config/settings.py:24-42`; `apps/worker/src/worker/main.py:45-54`). The untracked production draft reduces this to two handlers/four connections per worker (`deploy/production/compose.yaml:43-46`). If every check spends its full 15-second fetch deadline, two slots yield at most 480 attempts/hour, so 1,000 attempts need about 2.08 hours; four slots yield 960 attempts/hour and about 1.04 hours. Retries, robots requests, shared 2-second per-domain spacing, database time, and CSV/score work reduce those rates; short responses improve them. The first scale pressure is the shared database claimant and connection budget, not just CPU: the prior seeded 1M-row audit measured approximately 499 ms for a pending-domain claim (D-01), and same-domain dispatch remains globally serialized by the fetch limiter (`apps/worker/src/worker/config/settings.py:40-42`; `docs/runbooks/worker.md:344-353`). There is no real workload latency histogram to turn this scenario into a capacity promise.

For 1,000 base-page checks, the configured 2 MiB response-body cap permits up to about 2,000 MiB of accepted page bodies; redirects, retries, robots, crawl child pages, headers, and transfer encoding make network bytes different (`apps/worker/src/worker/config/settings.py:34-44`; `docs/runbooks/worker.md:34-40`). Search cost cannot be derived from 1,000 opportunities: one query can yield zero or many accepted URLs, and the provider reports credits per call (`apps/worker/src/worker/providers/serper.py:22-56`). A usable per-job cost ledger needs query attempts × billed credits, fetched and stored bytes, worker seconds, and DB/storage usage, then account prices. No dollar amount is defensible without those measurements or contract rates.

## Findings

### [I-01] Production deployment has no tracked, reversible release path
- Severity: BLOCKER
- Type: GAP
- Area: Infra
- Evidence: `docker-compose.yml:1-9`; `docs/adr/0011-local-first-hosting.md:1-5`; `deploy/production/README.md:7-21,78-87`; `git ls-files apps/web/Dockerfile deploy/production/compose.yaml` returned no paths; `.github/workflows/ci.yml:1-96`; D-03.
- Why it matters: The repository cannot reproduce the proposed production stack from a commit. The draft builds on a live host and has no rollback command, migration compatibility gate, or staging rehearsal; a bad application or schema change can leave jobs and data operations unavailable.
- Recommendation: Track and review the deployment artifacts; add staging, immutable image promotion, migration ordering/compatibility checks, smoke checks, and a tested image rollback plus forward-only database repair procedure. Effort L.
- Confidence: High

### [I-02] CI omits the core browser journey and uses a moving database toolchain
- Severity: HIGH
- Type: GAP
- Area: Process
- Evidence: `.github/workflows/ci.yml:7-96` (web, DB, worker, and secret-scan jobs but no Playwright invocation; Supabase CLI `latest` at line 32); `Makefile:35-36`; `apps/web/playwright.config.ts:3-19`; `docs/testing.md:29-45`.
- Why it matters: A change can pass every required check while breaking login, CSV ingestion, review, or export in the browser. A moving CLI can also change migration/test behavior independently of a code change.
- Recommendation: Add a serialized local-Supabase e2e CI job with its worker fixture and retained failure artifacts; pin the Supabase CLI version and run both container builds in CI. Keep the existing lint, type, unit, DB, dependency, and Gitleaks gates. Effort M.
- Confidence: High

### [I-03] Heartbeats are visible, but nobody is alerted when work stops
- Severity: HIGH
- Type: GAP
- Area: Reliability
- Evidence: `docs/runbooks/worker.md:166-189`; `apps/web/src/features/health/workers.ts:3-37`; `apps/web/src/app/api/system/workers/route.ts:8-25`; `apps/web/src/app/api/health/route.ts:1-3`; `apps/worker/src/worker/logging.py:6-16`; `apps/worker/src/worker/main.py:35-38,98-116`.
- Why it matters: A dead worker, stalled queue, broken Storage cleanup, or database outage can persist until a user notices. The Compose web healthcheck in the untracked draft accepts an `ok` from a process that has lost its dependencies (`deploy/production/compose.yaml:25-34`).
- Recommendation: Export queue age, worker heartbeat freshness, job completion latency, failure counts, uncertain Serper credits, and Storage cleanup backlog; send alerts to a named on-call destination. Add dependency-aware readiness separately from process liveness, job/worker IDs to all relevant logs, and a minimal dashboard. Set and review the provisional SLIs/SLOs above. Effort M.
- Confidence: High

### [I-04] The stuck-job runbook can corrupt retry accounting
- Severity: HIGH
- Type: CONFLICT
- Area: Reliability
- Evidence: `docs/runbooks/worker.md:256-281`; `supabase/migrations/20261013164139_m3_job_engine.sql:187-216`; `apps/worker/src/worker/engine/claims.py:66-76`; `apps/worker/src/worker/main.py:50-55`.
- Why it matters: The documented manual `UPDATE` resets every expired running row to `pending` and increments `attempts`, even at the limit. The real reaper preserves attempts and marks exhausted rows `failed`; an unfamiliar operator following the runbook can retry poison work beyond policy and change job outcomes. The runbook also says the live handler is absent, although `main.py` constructs it.
- Recommendation: Remove the raw update; give an operator a read-only, job-scoped diagnosis first and, if manual intervention is required, call the bounded `reap_expired_leases` RPC with expected counts and audit record. Refresh the stale handler instructions and include escalation and verification steps. Effort S.
- Confidence: High

### [I-05] Dependency and host failure recovery is not rehearsed
- Severity: HIGH
- Type: GAP
- Area: Reliability
- Evidence: `docs/runbooks/worker.md:222-297`; `deploy/production/README.md:1-5,78-87`; `deploy/production/compose.yaml:3-64`; `docs/adr/0011-local-first-hosting.md:1-5`; D-04.
- Why it matters: The runbook covers a few local worker symptoms but gives no on-call decision tree for database, Serper, Storage, tunnel, or host outage; it uses a local `worker:worker@127.0.0.1` test command at `docs/runbooks/worker.md:245-254`. A new on-call engineer cannot determine blast radius, stop paid search safely, restore service, or prove data recovery from this runbook alone.
- Recommendation: Write one incident sheet per dependency with detection, safe disable/rollback, job-state queries, escalation owner, recovery checks, and a timed game day. Define and test RPO/RTO and restore as already requested by D-04; do not repeat that database finding here. Effort M.
- Confidence: High

### [I-06] Container drafts lack immutable bases and worker health supervision
- Severity: MEDIUM
- Type: RISK
- Area: Infra
- Evidence: `apps/worker/Dockerfile:1-11` (`python:3.12-slim`, `uv:latest`, non-root user, no `HEALTHCHECK`); `docker-compose.yml:1-9`; `apps/web/Dockerfile:1-29` (untracked, non-root runner, `node:22-bookworm-slim`); `deploy/production/compose.yaml:38-64` (worker has no healthcheck, `cloudflare/cloudflared:latest`); `.github/workflows/ci.yml:87-95` (worker build and dependency/secret scans, no image scan).
- Why it matters: Rebuilds can pull different base/tool versions under the same commit. A worker process that stays alive while its loops repeatedly fail is considered running by Compose; the proposed healthcheck covers only web process liveness.
- Recommendation: Pin base and tool images by digest, rebuild on a scheduled security patch cadence, scan produced images, and add an external worker/queue freshness check. Preserve the existing non-root execution. Effort S.
- Confidence: High

### [I-07] There is no measured capacity or cross-service spend guard
- Severity: MEDIUM
- Type: GAP
- Area: Infra
- Evidence: `apps/worker/src/worker/config/settings.py:24-44`; `deploy/production/compose.yaml:43-53`; `docs/runbooks/worker.md:299-326`; `apps/worker/src/worker/providers/serper.py:22-56`; D-01/D-02; P-04/B-04.
- Why it matters: Raising replica count multiplies connection demand and does not defeat the shared-domain delay or expensive claim path. Job credit budgets do not bound account-wide paid-search loss after a crash (P-04/B-04), and there is no measured per-job fetch/storage/compute cost or alarm to show when economics change.
- Recommendation: Load-test one and N workers with representative domain mix, record p50/p95 check and claim latency plus connection saturation, and set replica/pool limits. Meter credits, bytes, worker time, and storage per job; alert on daily account spend and unexpected cost per 1,000 opportunities. Effort M.
- Confidence: High

### [I-08] Environment and secret operations are defined only by local files
- Severity: MEDIUM
- Type: GAP
- Area: Security
- Evidence: `docs/secrets.md:3-46`; `supabase/config.toml:5-10,32-46,116-119` (local project settings); `deploy/production/README.md:54-65,85-87`; `deploy/production/production.env.example:1-28`; `.gitignore:14-22`; `git ls-files '*tf' '*tfvars' '*.bicep' '*.yaml' '*.yml'` found no tracked infrastructure definition beyond `.github/workflows/ci.yml`.
- Why it matters: The draft requires an operator to fill and copy a host-local file with service-role, SMTP, worker database, Serper, and tunnel secrets; there is no separate staging project, rotation sequence, or reproducible host/network configuration. A lost host or leaked secret would require improvisation.
- Recommendation: Define separate dev/staging/prod projects and variable ownership; keep production values in a managed secret store with documented rotation and break-glass access. Track the minimum host, tunnel, and backup configuration as IaC or an equivalent tested provisioning runbook. Effort M.
- Confidence: High

## Things I could not verify

- Whether a VPS, Supabase Cloud project, Cloudflare Tunnel, staging project, alert service, or backup subscription already exists outside this repository. Evidence needed: deployment inventory, cloud configuration, and recent incident/restore records.
- Whether the CI workflow currently passes on GitHub or is protected by branch rules. Evidence needed: recent workflow runs and repository branch-protection settings.
- Actual worker throughput, Serper unit price, billed credits, network bytes, storage growth, and cost per 1,000 opportunities. Evidence needed: representative job traces, provider invoices, usage metrics, and host bills.
- Whether the untracked production draft has been reviewed or deployed. A successful `docker compose config --quiet` check only validates its static Compose configuration.

## Questions for the owner

1. Is this intended to remain a local internal tool, or is the untracked single-VPS draft the approved first production target? Who owns the production on-call rotation?
2. What are the acceptable job latency, RPO, RTO, and maximum daily Serper spend? What job size/domain mix should define the first load test?
3. Which Supabase and Storage backup/restore features are enabled today, and when was a restore last tested?
4. What is the intended staging environment and who may approve migrations and production promotion?
