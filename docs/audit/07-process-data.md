# Process and data audit

## Executive summary

1. The product records jobs, reviews, and link checks, but no user journey events or tracking plan; activation and retention cannot be measured (`supabase/migrations/20261010181643_m2_jobs_schema.sql:189-205`; `apps/web/src/features/jobs/queries.ts:101-119`).
2. The review capture audit checks snapshot completeness, not whether labels are correct or representative (`scripts/audit-review-capture.sql:13-62`).
3. Synthetic calibration is a useful regression fixture, but its reported 0.739 precision is not field accuracy (`docs/testing.md:256-268`).
4. Placements can be joined to reviewed opportunities, yet current reports do not show a scored cohort through contact and verified delivery (P-03; `supabase/migrations/20261104060000_link_delivery_report.sql:13-67`).
5. Worker switches can disable costly stages, but there is no user assignment, variant logging, or comparison analysis for experiments (`apps/worker/src/worker/config/settings.py:17-18,32,43-44`).
6. The tracked CI checks lint, types, units, DB, worker integration, security tools, and builds; it does not run the seven Playwright specs (`.github/workflows/ci.yml:7-96`; `apps/web/playwright.config.ts:3-24`).
7. The PR Definition of Done omits browser, recovery, security, and rollout evidence despite those being live risks (`.github/pull_request_template.md:3-10`; I-01, I-02, S-01, D-04).
8. `docs/development.md` advertises scripts absent from `apps/web/package.json`, so onboarding guidance is not executable as written (`docs/development.md:391-399`; `apps/web/package.json:5-15`).
9. The tracked history has three author identities with the same apparent name; human ownership and backup coverage remain **UNVERIFIED** (`git shortlog -sne HEAD`; `.github/` inventory).
10. New findings: **BLOCKER 0, HIGH 3, MEDIUM 3, LOW 0**. Earlier audit IDs carry overlapping product, security, and reliability findings.

## What can be measured today

`job_events` is a job activity log with a job ID, type, payload, actor, and timestamp. `opportunity_reviews` snapshots decisions and score inputs, while `link_placements` and `link_placement_events` record manual outreach state and verification outcomes (`supabase/migrations/20261010181643_m2_jobs_schema.sql:189-205`; `supabase/migrations/20261028010000_m6_review_schema.sql:39-55,107-125`; `supabase/migrations/20261030030000_m7_review_scoring_capture.sql:22-56`; `supabase/migrations/20261104050000_link_placements.sql:4-48`). These are operational and decision records, not a product event stream. A search of tracked web and worker source for PostHog, Segment, Mixpanel, Amplitude, Plausible, `gtag`, analytics, telemetry, and experimentation found no product instrumentation; `rg` found only unrelated uses of “analytics” and “segment.” No tracking-plan file was found in `git ls-files`.

| Decision the team needs to make | Current signal | Missing denominator or event |
| --- | --- | --- |
| Is onboarding clear enough? | Accounts and jobs exist. | Invite accepted, first login, first valid CSV, first started job, abandonment and time to first reviewed prospect by user cohort. |
| Is the daily review loop efficient? | Review decisions and timestamps exist. | Queue impression/open, time per decision, skipped items, session length, reviewer cohorts and reason for exit. |
| Which discovery source deserves credits? | Query credits, source attribution, approval counts and placements exist (`supabase/migrations/20261030010000_m7_report_metrics.sql:63-107`; `supabase/migrations/20261104060000_link_delivery_report.sql:13-67`). | Comparable exposed/scored/contacted cohort, plus verified placement outcome and elapsed time per source. |
| Do customers return or find enough value? | Job and review records exist. | Account-level active use, repeat jobs, repeat exports, retention cohort, stated buyer outcome and cancellation reason. |
| Does a feature change help? | Worker-wide boolean switches exist. | Stable assignment, exposure, variant/config version, guardrail metrics, and a comparison plan. |

The quality plan names qualified domains per credit, precision at 20, verified live links, cost per verified link, and crawl health. It explicitly says small samples should not be treated as outcomes (`docs/backlink-quality-performance-plan.md:12-28`). That is a partial metrics plan, not a tracking plan or a declared North Star; P-01 covers the missing product decision contract. I found no cohort/funnel instrumentation in the code reviewed. A production telemetry service outside this repo is **UNVERIFIED**.

## Review labels and scoring feedback

The capture audit verifies that each decided opportunity has a matching review row, score snapshot, scoring inputs, and rejection metadata; it performs no label adjudication or outcome analysis (`scripts/audit-review-capture.sql:13-62`). The migration freezes algorithm/config versions and six component raw values at a status change, which is valuable provenance (`supabase/migrations/20261030030000_m7_review_scoring_capture.sql:22-56`). The worksheet offers a seven-label rubric and instructs PM decisions in the app, but its 24 example rows have blank PM labels (`docs/yogaban-prospect-review-worksheet.md:5-38`). The committed calibration set contains 40 synthetic pages and reports 17 relevant among 23 ranked; its own documentation disclaims production accuracy (`docs/testing.md:256-268`; `apps/worker/tests/fixtures/checks/README.md:1-20`).

**Minimum labeled-data strategy:** choose 100–200 real candidate URLs across at least two niches and each score band, including auto-filtered, unchecked, backlog, and search results never opened by reviewers. Freeze the rubric and scorer/config version; have two independent reviewers label a stratified subset and adjudicate disagreements. Keep a holdout by job/site so related pages do not leak across tuning and evaluation. Record the opportunity ID, exposure/selection method, label, reason, reviewer, timestamp, and reachable-page state; then follow an approved/contacted cohort to verified or unverified placement at fixed windows. Report precision at 20 with denominator and uncertainty, missed viable pages, agreement, and verified-link conversion by score band. This is a proposed experiment, not a claim that current data already supports those estimates. P-02 and P-03 record the underlying score and outcome gaps.

## Testing and delivery inventory

Tracked-file count (`git ls-files` with test-path patterns): **43 web unit test files, 7 Playwright specs, 32 worker unit files, 17 worker integration files, and 52 pgTAP files**. The prior database audit replayed 69 migrations and passed 1,197 SQL assertions on a disposable local stack (D-01–D-07). File counts are inventory, not line or branch coverage. Neither the web test scripts nor worker dev dependencies configure a coverage reporter (`apps/web/package.json:5-15,41-55`; `apps/worker/pyproject.toml:23-45`), so a reproducible coverage percentage is **UNVERIFIED**.

| Layer | Present | Gap that affects a release decision |
| --- | --- | --- |
| Unit/property/regression | Vitest; pytest with Hypothesis; synthetic scoring corpus (`apps/worker/pyproject.toml:23-45`; `docs/testing.md:256-268`). | Real score precision and false negatives are not unit-testable from synthetic labels (P-02). |
| DB and worker integration | CI resets Supabase, runs pgTAP and worker integration; search uses fake Serper responses (`.github/workflows/ci.yml:26-73`; `docs/testing.md:76-85`). | No live-provider contract gate or independently reconciled billing evidence (P-04; B-04). |
| Browser | Seven local-only Playwright specs run serially against a fresh production build and seeded users (`docs/testing.md:29-59`; `apps/web/playwright.config.ts:3-24`). | CI never runs them (I-02); failure, accessibility and denied states are unevenly covered (UX-09). |
| Performance/load | CSV memory benchmark is documented (`docs/testing.md:147-155`). | No recurring query/queue load gate; a 1M-opportunity report took 6.6 seconds in the prior benchmark (D-01, D-02). |
| Security/recovery | CI runs pnpm audit, pip-audit and Gitleaks (`.github/workflows/ci.yml:24,87,90-96`); job deletion and Storage cleanup have e2e/integration checks (`apps/web/e2e/jobs.spec.ts:259-307`; `apps/worker/tests/integration/test_storage_cleanup.py:33-67`). | The `users.manage` escalation has no adversarial role-builder regression (S-01); backup/restore has no drill (D-04); provider-spend crash replay is unresolved (B-04). |

`CONTRIBUTING.md` asks for conventional commits and one S-task per PR, and points to the PR template (`CONTRIBUTING.md:1-3`). A commit-msg hook exists (`.pre-commit-config.yaml:14-18`), while CI runs on pull requests and pushes to `main` (`.github/workflows/ci.yml:1-5`). The latest 12 commit subjects include “UI changes and MVP2” and “Update pnpm version to 10.29.1 in ci.yml,” so the convention is not consistently reflected in history (`git log -12 --format='%s'`). There is no tracked CODEOWNERS, changelog/release notes, release tag, or branch-policy document in `git ls-files`/`git tag -l`; repository-host branch protection is **UNVERIFIED**.

## Documentation health and payoff order

README provides a concise component map, local setup, and links to the main guides (`README.md:15-52`). It is not an end-to-end architecture/onboarding runbook, API reference, or incident response plan. The dated `pre-m5-readiness-review.md` and `qa-browser-report-2026-10-29.md` are useful historical evidence but should be labeled as archived snapshots and linked to current status; O-05/O-10 already identify milestone drift (`docs/pre-m5-readiness-review.md:1-5`; `docs/qa-browser-report-2026-10-29.md:1-9`). `docs/development.md` still describes Poetry as an alternative despite no tracked Poetry project file and advertises `pnpm lint:fix`, `format:write`, `test:watch`, and `test:coverage` absent from package scripts (`docs/development.md:58-69,391-399`; `apps/web/package.json:5-15`). Worker incident guidance exists but includes a hazardous manual recovery instruction (I-04). The draft production deployment is untracked, so ownership and release procedure are not established (I-01).

| Payoff order | Debt or missing decision | Cost of delay | Smallest next payment |
| --- | --- | --- | --- |
| 1 — before another privileged rollout | `users.manage` escalation (S-01), unverified restore (D-04), absent release/rollback ownership (I-01). | An avoidable privilege incident or irrecoverable data loss during a change. | Add DB regression and fix role boundary; perform one restore drill; name a release owner and rollback path. |
| 2 — before another paid pilot | Account spend cap and crash replay (P-04, B-04), provider reconciliation, alerting (I-03). | Credits can be spent without an account-wide stop or timely detection. | Set account cap, reconcile actual credits after a tiny paid run, alert on spend and stalled queues. |
| 3 — before tuning scores or search order | Real labels, selection records, and scored-to-placement cohort (P-02, P-03, PD-01, PD-02). | Each heuristic change can look better on selected reviews while hiding false negatives or worse delivery. | Label stratified sample and publish one cohort/precision report. |
| 4 — before growing result volume | Queue/report load paths (D-01, D-02), browser CI (I-02), release test gaps (PD-04). | Reviews slow down and regressions escape into operations. | Add a measured query gate and one seeded browser smoke gate. |
| 5 — routine maintenance | Stale guides, no explicit ownership, historical reviews mixed with live guidance (PD-05, PD-06; O-05/O-10). | Onboarding and incident response depend on the person who remembers which doc is current. | Correct commands, archive snapshots, and assign owners/review dates to live docs. |

## Findings

### [PD-01] Product decisions lack a user journey measurement layer
- Severity: HIGH
- Type: GAP
- Area: Data
- Evidence: `supabase/migrations/20261010181643_m2_jobs_schema.sql:189-205`; `apps/web/src/features/jobs/queries.ts:101-119`; `supabase/migrations/20261030010000_m7_report_metrics.sql:63-107`; `docs/backlink-quality-performance-plan.md:18-28`; `rg -n -i 'posthog|mixpanel|amplitude|plausible|segment|gtag|analytics|telemetry|experiment' apps/web/src apps/worker/src` found no product event instrumentation.
- Why it matters: Job and review records can answer operational counts, but not onboarding abandonment, review effort, retention, or which user cohort gets value. Product changes cannot be judged against a consistent activation or usage baseline; P-01 covers the missing North Star decision.
- Recommendation: Name one outcome metric and its owner; define a short event contract for invite, job setup/start, first reviewed prospect, export, and repeat use, with stable user/job IDs and a privacy-safe retention rule. Build one activation and review-throughput cohort report before adding more events. Effort M.
- Confidence: High

### [PD-02] Review capture integrity is mistaken for label quality
- Severity: HIGH
- Type: RISK
- Area: Data
- Evidence: `scripts/audit-review-capture.sql:13-62`; `supabase/migrations/20261030030000_m7_review_scoring_capture.sql:22-56`; `docs/yogaban-prospect-review-worksheet.md:5-38`; `docs/testing.md:256-268`; `supabase/migrations/20261030010000_m7_report_metrics.sql:43-50,69-107`.
- Why it matters: The audit can pass when reviewers label only the visible top queue, disagree on what is linkable, or never inspect filtered candidates. A precise score snapshot does not establish precision, recall, or conversion; P-02 and P-03 describe those outcome gaps.
- Recommendation: Own a versioned labeling protocol with stratified sampling of ranked and excluded pages, independent double-labeling of a subset, adjudication, and a held-out evaluation by niche/job. Publish precision at 20, missed-good rate, agreement, and scored-to-verified conversion with denominators before changing weights. Effort M.
- Confidence: High

### [PD-03] Switches cannot establish experiment effects or safe cohorts
- Severity: MEDIUM
- Type: GAP
- Area: Process
- Evidence: `apps/worker/src/worker/config/settings.py:17-18,32,43-44`; `docs/backlink-quality-performance-plan.md:63-80,90-94`; `.github/workflows/ci.yml:1-96`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:92-152`.
- Why it matters: Worker-wide booleans can stop search, crawl, or verification, but cannot assign comparable jobs or record who saw which variant. Toggling a stage across all jobs gives no causal readout and no controlled production ramp; I-01 covers the absent deployment path.
- Recommendation: For the next risky change, define an eligible job cohort, deterministic assignment, stored config/variant exposure, primary metric and guardrails, then pilot a small manually approved cohort. Keep emergency off switches; add general flag infrastructure only if repeated experiments justify it. Effort M.
- Confidence: High

### [PD-04] Release gates miss the scenarios that matter most
- Severity: HIGH
- Type: GAP
- Area: Process
- Evidence: `.github/workflows/ci.yml:7-96`; `.github/pull_request_template.md:3-10`; `apps/web/e2e/role-builder.spec.ts:32-87`; `apps/web/e2e/jobs.spec.ts:259-307`; `apps/worker/tests/integration/test_search_runner.py:16,119-130,311-342`; `docs/testing.md:76-85`; S-01, B-04, D-04, I-02.
- Why it matters: The suite is broad, but a green PR does not exercise browser flows, a lower-privilege user's path to Admin, paid-call replay after a crash, or recovery from backup. These are release decisions, not coverage-percentage targets.
- Recommendation: Add one adversarial role assignment DB test, one crash-after-provider-response spend test, a scheduled restore drill, and a seeded Playwright smoke job in CI. Put these gates and a migration/rollback note in the PR checklist. Effort M.
- Confidence: High

### [PD-05] Contributor and setup guidance disagree with executable workflow
- Severity: MEDIUM
- Type: DOC-DRIFT
- Area: Process
- Evidence: `docs/testing.md:3-10`; `Makefile:9-11`; `docs/development.md:58-69,370-399`; `apps/web/package.json:5-15`; `.github/pull_request_template.md:3-10`; `.pre-commit-config.yaml:14-18`; `git log -12 --format='%s'`.
- Why it matters: `make check` is documented as needing no running service and touching no data, but it runs worker integration tests against local Supabase (O-02). Missing script names and an unsupported Poetry path waste onboarding time; the stated commit and DoD conventions are inconsistently enforced.
- Recommendation: Correct the command table and remove nonexistent scripts/Poetry instructions; document the actual DB preconditions. Make the PR template name browser, migration, security, recovery, and rollout checks when relevant, with a clear owner for exceptions. Effort S.
- Confidence: High

### [PD-06] Live ownership is undocumented and historical reports resemble current instructions
- Severity: MEDIUM
- Type: RISK
- Area: Process
- Evidence: `git shortlog -sne HEAD` shows 7, 5, and 4 commits under three identities with the same apparent author; `git ls-files .github` lists only the PR template and CI workflow; `git ls-files | rg -i '(CODEOWNERS|CHANGELOG|release.?notes|onboard|incident|openapi)'` and `git tag -l` returned no matches; `docs/pre-m5-readiness-review.md:1-5`; `docs/qa-browser-report-2026-10-29.md:1-9`; `docs/runbooks/worker.md:79-101`.
- Why it matters: The repo cannot show who owns scoring labels, Serper spend, permissions, releases, restore, or on-call response. Git identities do not prove the human bus factor, but absent owner and handoff records make critical decisions dependent on tacit knowledge; O-05/O-10 and I-04 cover concrete stale guidance.
- Recommendation: Assign named primary and backup owners for product metrics, paid search, database recovery, security, and releases. Mark dated readiness/QA reports as snapshots, index current runbooks, and add a one-page architecture/API/incident entry point with a review date. Effort S.
- Confidence: Medium

## Things I could not verify

- Actual product analytics, dashboards, tracking plan, or customer research outside the tracked repository; none was provided to this audit.
- Real-score precision, recall, label agreement, prospect-to-verified conversion, and retention: the committed sample is synthetic and the Yogaban PM labels are blank (`docs/testing.md:256-268`; `docs/yogaban-prospect-review-worksheet.md:9-38`).
- A numerical line/branch coverage figure: no coverage reporter or checked-in coverage report was found in the web and worker test configuration (`apps/web/package.json:5-15,41-55`; `apps/worker/pyproject.toml:23-45`).
- Branch protection, required review rules, team roster, deploy history, incident history, and a real restore drill from the local Git checkout. Three Git identities may all belong to one person; this is evidence of contribution concentration, not proof of staffing.
- Current CI pass status or a fresh full test run. This process audit inspected tracked definitions and prior verified results; it did not reset a database, call Serper, or run the browser suite.

## Questions for the owner

1. Who is the buyer, daily reviewer, product-metric owner, and backup decision maker for scoring and paid-search spend?
2. Where, if anywhere, are activation/retention dashboards and a tracking plan maintained outside the repo?
3. Who will label the first real stratified sample, adjudicate disagreements, and track contacted prospects through verified placement?
4. Which launch gate is binding: internal pilot, paid customer use, or production availability, and who approves a rollout and rollback?
5. Are CODEOWNERS, branch protection, backup/restore evidence, and an on-call rotation configured outside Git?
