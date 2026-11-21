# Audit synthesis and production decision

## Executive summary

1. **NO-GO for customer-facing, always-on production** on the evidence in this checkout; the three blockers are independent security, data-handling and release failures (B-01, S-01, I-01).
2. An invalid CSV value can become a spreadsheet formula in an error download (B-01), and a `users.manage` holder can reach Admin (S-01).
3. The proposed production stack is untracked and lacks a reproducible rollback and migration gate (I-01, D-03).
4. The database was replayed successfully from 69 migrations and 1,197 pgTAP assertions passed, but that does not prove a safe live upgrade or restore (`docs/audit/04-database.md:15-21`; D-03, D-04).
5. There are 32 source HIGH findings, concentrated in paid spend, long transactions, stale/deceptive UI state, missing operating controls and unproven prospect quality.
6. Four pairs of HIGH findings describe the same failure or proof gap; the table below has **28 distinct HIGH rows** and preserves all source IDs.
7. Paid search is off by default, but when enabled a crash can replay a charged call and separate jobs can consume an uncapped account allowance (B-04, P-04).
8. Scores and review snapshots are reproducible, yet real precision, false negatives and prospect-to-verified-link conversion are **UNVERIFIED** (P-02, P-03, PD-02).
9. The roadmap is a sequence of acceptance gates, not a credible four-week staffing promise for 3 blockers and 28 HIGH workstreams; production remains closed until the applicable gates pass.
10. Source corpus: **3 BLOCKER, 32 HIGH, 39 MEDIUM, 1 LOW** across nine reports; consolidated table: **3 BLOCKER and 28 HIGH groups**; this synthesis adds no new finding IDs.

## 1. Go / no-go

**NO-GO for customer-facing, always-on production.** The code permits CSV formula injection through error downloads and Admin escalation through `users.manage`, while the proposed deployment has no tracked, rehearsed rollback path (B-01, S-01, I-01). The remaining HIGH risks include uncontrolled paid-search exposure, untested recovery, and user-visible workflow failures, and real score-to-link value has not been demonstrated (B-04, P-04, D-04, UX-01, P-02, P-03).

A private, supervised pilot with paid search disabled and disposable data is a different risk decision; it is **not** evidence that the production gate has passed (`apps/worker/src/worker/config/settings.py:17-18,43-44`; `docs/audit/01-product.md:142-150`). No production deployment or external exploitation was attempted in this synthesis.

## 2. BLOCKER and HIGH findings, deduplicated

**Ordering rule:** an ordinal risk-to-effort score, **BLOCKER = 6, HIGH = 3**, divided by estimated effort **S = 1, M = 2, L = 3**. It is a triage heuristic, not an expected-loss estimate; ties put active security/data harm before user pain and future scale. Every BLOCKER is still a hard production gate regardless of its score. Combined rows retain each source ID and use an effort estimate for the combined remedy.

| Ratio | Severity · effort | Consolidated risk and source findings | Production decision / smallest credible remedy |
| ---: | --- | --- | --- |
| **6.0** | BLOCKER · S | **B-01** spreadsheet formula injection in CSV error reports (`docs/audit/03-backend-api.md:62-69`). | Escape dangerous leading cells in both error paths and test round trips. |
| **3.0** | BLOCKER · M | **S-01** `users.manage` can grant or self-assign Admin (`docs/audit/06-security.md:71-78`). | Enforce a DB role-assignment ceiling and apply it before service-key invites. |
| **3.0** | HIGH · S | **B-07** unexpected fetcher defects become site failures (`docs/audit/03-backend-api.md:116-123`). | Propagate unexpected errors to bounded worker retry; test a synthetic defect. |
| **3.0** | HIGH · S | **I-04** stuck-job runbook can corrupt retry counts (`docs/audit/05-infra-reliability.md:68-75`). | Remove raw recovery UPDATE; use the bounded reaper and verify counts. |
| **3.0** | HIGH · S | **O-01** worker examples connect as database superuser (`docs/audit/00-orientation.md:153-160`). | Use restricted worker credentials and reject superuser at startup. |
| **3.0** | HIGH · S | **O-02** “data-free” `make check` runs DB integration (`docs/audit/00-orientation.md:162-169`). | Split unit and integration targets or document and guard DB mutation. |
| **2.0** | BLOCKER · L | **I-01 + D-03** untracked, nonreversible release path and unsafe online migration patterns (`docs/audit/05-infra-reliability.md:41-48`; `docs/audit/04-database.md:106-113`). | Track deployment, rehearse expand/contract migrations, promote immutable images and prove rollback. |
| **1.5** | HIGH · M | **B-04** crash can replay a charged Serper request (`docs/audit/03-backend-api.md:89-96`). | Persist call intent, reconcile billed usage and require review before replay. |
| **1.5** | HIGH · M | **P-04** job-level credits do not cap account spend (`docs/audit/01-product.md:70-77`). | Add an account allowance, concurrent hard stop and spend alerts. |
| **1.5** | HIGH · M | **UX-04** CSV deletion can report success while Storage still holds the file (`docs/audit/02-ux-frontend.md:104-111`). | Check removal result, queue durable cleanup and show pending state. |
| **1.5** | HIGH · M | **D-05** confirmed CSV staging rows persist despite purge claim (`docs/audit/04-database.md:124-131`). | Decide retention, then purge safely after import or declare/limit retention. |
| **1.5** | HIGH · M | **B-05** Serper outage claims cycle without durable cooldown (`docs/audit/03-backend-api.md:98-105`). | Persist delayed retry, honor `Retry-After` and pause provider claims. |
| **1.5** | HIGH · M | **S-02** public reset amplifies email and Auth cost (`docs/audit/06-security.md:80-87`). | Add per-account and per-IP cooldown with generic response and volume alarm. |
| **1.5** | HIGH · M | **B-06** error report fallback may truncate and primary download buffers all bytes (`docs/audit/03-backend-api.md:107-114`). | Stream or page completely; return an error instead of partial success. |
| **1.5** | HIGH · M | **D-04 + I-05** backup/restore and dependency failure response are neither specified nor rehearsed (`docs/audit/04-database.md:115-122`; `docs/audit/05-infra-reliability.md:77-84`). | Set RPO/RTO and complete isolated DB/Storage restore plus DB/Serper/Storage/worker drills. |
| **1.5** | HIGH · M | **I-02 + PD-04** CI omits browser journey and critical adversarial/recovery gates (`docs/audit/05-infra-reliability.md:50-57`; `docs/audit/07-process-data.md:91-98`). | Run seeded Playwright in CI, pin toolchain and add targeted crash/role tests. |
| **1.5** | HIGH · M | **I-03** heartbeats have no alert destination (`docs/audit/05-infra-reliability.md:59-66`). | Alert on queue age, worker freshness, failures and uncertain spend. |
| **1.5** | HIGH · M | **UX-05** server data failure has no local recovery boundary (`docs/audit/02-ux-frontend.md:113-120`). | Add route retry and isolate independent report sections. |
| **1.5** | HIGH · M | **UX-01** CSV/Results tabs can hide active work without refresh (`docs/audit/02-ux-frontend.md:77-84`). | Extend visibility-aware polling and last-updated/status cues. |
| **1.5** | HIGH · M | **UX-02** claim-first review and page-boundary navigation slow the core loop (`docs/audit/02-ux-frontend.md:86-93`). | Measure decision time, then preserve fencing in atomic claim-and-decide and cross-page next. |
| **1.5** | HIGH · M | **O-03** Ready queue replacement contradicts ADR 0023 (`docs/audit/00-orientation.md:171-178`). | Choose stable exposure or ranked replacement, then align SQL, UI and metrics. |
| **1.5** | HIGH · M | **P-02 + PD-02** score quality and label representativeness are unproven (`docs/audit/01-product.md:52-59`; `docs/audit/07-process-data.md:73-80`). | Stratify real labels, adjudicate and evaluate a held-out cohort. |
| **1.5** | HIGH · M | **P-03** placement records do not close the score-to-link loop (`docs/audit/01-product.md:61-68`). | Follow scored/contacted cohorts to verified placement with denominators. |
| **1.5** | HIGH · M | **PD-01** no product journey event plan or cohort view (`docs/audit/07-process-data.md:64-71`). | Instrument activation, review effort and repeat use with minimal events. |
| **1.5** | HIGH · M | **A-02** no rule for SQL versus Python/Next business-policy ownership (`docs/audit/08-adr-challenge.md:99-106`). | Record invariant/policy boundary and test rules duplicated across layers. |
| **1.5** | HIGH · M | **A-03** launch boundaries for tenancy, hosting, data and score evidence are implicit (`docs/audit/08-adr-challenge.md:108-115`). | Record explicit internal-only/hosted/data/scoring decision gates. |
| **1.0** | HIGH · L | **P-08** global permissions would expose customer jobs in a SaaS model (`docs/audit/01-product.md:106-113`). | Keep one internal workspace as a hard supported boundary, or build org-scoped RLS/RPCs before external tenants. |
| **1.0** | HIGH · L | **B-02** CSV staging holds long locks through parsing and Storage (`docs/audit/03-backend-api.md:71-78`). | Claim-scoped generations, bounded commits and external upload outside transaction. |
| **1.0** | HIGH · L | **B-03** whole-job rescore transaction can stall large jobs (`docs/audit/03-backend-api.md:80-87`). | Versioned score generations with batch commits, or an enforced job-size cap. |
| **1.0** | HIGH · L | **D-01** claim path repeatedly scans pending domains (`docs/audit/04-database.md:88-95`). | Index-ordered/materialized frontier and repeat the 1M-row benchmark. |
| **1.0** | HIGH · L | **D-02** report RPC scans and rejoins too much history (`docs/audit/04-database.md:97-104`). | Date index and bounded aggregation with measured latency target. |

**Deduplication ledger:** D-03 is the migration part of I-01's release gate; I-05 includes D-04's restore drill; PD-04 repeats I-02's CI gate plus tests for already listed S-01/B-04/D-04; PD-02 is the label-quality method needed to validate P-02. The other HIGH IDs describe distinct failure mechanisms or decisions, even when a roadmap package fixes several together. No source HIGH or BLOCKER ID is dropped.

## 3. Cross-cutting themes

| Pattern in at least three areas | Evidence across areas | Consequence |
| --- | --- | --- |
| **No settled authority for critical rules.** | Product budget/tenant boundary (P-04, P-08), Backend dual planners and replay (B-04, B-09), DB migration/RLS policy (D-03, D-07), Security role escalation (S-01), Process ownership ADR (A-02). | A locally correct UI or worker rule can be bypassed or invalidated in another layer. |
| **Happy-path proof is ahead of real-world proof.** | Product real labels/placements (P-02, P-03), UX failure and accessibility states (UX-09), Infra browser/dependency drills (I-02, I-05), DB live upgrades/restore (D-03, D-04), Process release gates (PD-04). | “Tests pass” is being used too broadly for customer value and recoverability. |
| **Work and data have weak outer bounds.** | Product account spend (P-04), Backend CSV transaction and exports (B-02, B-06), DB queue/report scans and staging retention (D-01, D-02, D-05), UX list caps (UX-08), Infra capacity/spend (I-07). | More jobs, rows or users can create money loss, latency, hidden data or retention exposure. |
| **Operating state is visible only to someone watching.** | UX stale job tabs and page failures (UX-01, UX-05), Backend provider retries/poison work (B-05, B-08), Infra heartbeat without paging (I-03), DB restore uncertainty (D-04), Data missing journey instrumentation (PD-01). | Failures persist silently and the user cannot distinguish delay from failure. |
| **Documentation is treated as current after behavior changed.** | Product milestone claims (P-11), Backend queue behavior (B-09), DB dictionary purge claim (D-05), Infra hazardous runbook (I-04), Security service-key boundary (O-09), Process ADR drift (O-03, A-01). | Operators make decisions against a policy the code no longer implements. |

## 4. Conflicts between audit areas and resolution

| Tension | Recommended resolution |
| --- | --- |
| **Security vs admin convenience:** restricting `users.manage` may slow legitimate delegation (S-01, UX-11). | Treat Admin grant as a separately authorized event in Postgres, expose an explicit request/approval path if needed, and log actor/target/role. Do not rely on hiding the Admin option in the form. |
| **Privacy/deletion vs score learning:** retention limits and CSV deletion remove evidence that a placement cohort needs (P-03, P-10, D-05, UX-04, PD-02). | Define purpose and retention first; keep only minimal labeled outcome fields with pseudonymous IDs and versioned score snapshots, purge raw staging/files on schedule, and remove/anonymize cohort rows on an authorized deletion request. Aggregate rates after deletion. |
| **Reviewer stability vs higher-ranked Ready:** replacement may improve today's top results but silently move a previously seen candidate (O-03, UX-02, P-02). | Choose stable reviewer-facing Ready membership for the current internal pilot; rank before initial publication and use explicit bounded replenishment. Preserve `first_ready` cohort and compare precision using exposure order; only reintroduce replacement with a new ADR and visible UI cue. |
| **Atomicity vs throughput:** one large CSV or rescore transaction protects consistency but blocks controls and magnifies WAL/lock time (B-02, B-03, D-01). | Use fenced staging/score generations with bounded commits and one short atomic promotion. Until proven, enforce a measured size cap; do not weaken the fence to gain throughput. |
| **Polite/safe fetching vs speed:** robots, SSRF and shared domain spacing can make jobs take hours (I-07, UX-01; ADRs 0007/0016/0018). | Keep safety limits, improve claim/query efficiency, then show stage, last progress and estimated range in the UI. Measure p95 job latency before adding replicas or relaxing any fetch rule. |
| **Fast developer checks vs complete release checks:** `make check` currently claims to be unit-only while touching DB, and CI omits browser coverage (O-02, I-02, PD-04). | Make `make check` genuinely offline; run DB integration and a deterministic browser journey as named required CI jobs. Keep a longer performance/failure drill on schedule rather than hiding it in the local quick command. |

## 5–6. Phased roadmap with proof for each item

**Planning constraint:** with one small team, the listed L packages cannot all finish inside four weeks. The phase labels identify the order and launch gates; dates move if capacity or evidence is missing. Week 1 closes all blockers before any production promotion. Weeks 2–4 resolve HIGH risks or enforce tested scope/cap limits; Month 2–3 pays down MEDIUM and structural debt. A controlled internal pilot can collect labels, but it must not be described as a production launch.

| Phase / item | Owner role · effort | Acceptance criteria | Test or metric proving closure |
| --- | --- | --- | --- |
| **W1-1 CSV formula safety** (B-01) | Backend + Frontend · S | Both stored and fallback error CSVs neutralize cells starting `=`, `+`, `-`, `@` without losing the original text in-app. | Round-trip CSV tests for both paths; opening exported fixture in a spreadsheet shows text, not a formula. |
| **W1-2 Admin boundary** (S-01) | Security + DB + Web · M | A `users.manage`-only role cannot self-assign or invite Admin unless the product explicitly makes it Admin-equivalent; role changes are logged. | RLS/RPC and e2e tests under a custom role cover direct profile update, invite and legitimate Admin flow. |
| **W1-3 Reproducible release** (I-01, D-03) | SRE + DB lead · L | Deployment files are tracked; a staging promotion uses immutable image digests, rehearsed compatible migrations, smoke checks and documented rollback/forward repair. No live upgrade is inferred from `db reset`. | From a clean clone, deploy to staging, run a real DB-backed job, roll back web/worker image, and record migration lock times on a production-sized copy. |
| **W1-4 Restore and outage ownership** (D-04, I-05) | SRE + DB lead · M | Named backup and incident owners, approved RPO/RTO, DB and Storage coverage, and dependency decision sheets exist. | Isolated restore plus DB/Serper/Storage/worker failure drills finish within approved RPO/RTO; evidence includes timestamps and restored object counts. |
| **W1-5 Safe operator paths** (O-01, O-02, I-04) | Backend lead + SRE · S | Worker examples use the restricted role; quick check cannot mutate local DB; stuck-job runbook no longer issues raw state updates. | Startup rejects superuser URL, `make check` runs without Supabase, and a fixture stuck row is recovered through the bounded RPC with unchanged attempt ceiling. |
| **W1-6 Failure classification and deletion honesty** (B-07, UX-04) | Backend + Frontend · M | Unexpected fetcher errors retry as infrastructure errors; failed CSV Storage removal leaves durable cleanup and visible “pending,” never “deleted.” | Fault-injected fetch test preserves lease/retry; Storage failure e2e shows pending, worker retry removes object, then UI confirms deletion. |
| **W2-1 Paid-search budget/replay/outage** (B-04, B-05, P-04) | Backend + Finance/product ops · L | Account hard cap applies across jobs/workers; uncertain in-flight calls are reconciled before replay; 429/5xx have durable cooldown and operator pause. | Two-worker concurrency and crash-after-response tests show no unreviewed second paid call; provider ledger matches reported credits within a predeclared tolerance; outage fixture honors `Retry-After`. |
| **W2-2 Abuse controls** (S-02) | Security + Web · M | Per-account/IP reset limits retain a generic response and expose volume alarms. | Burst test cannot generate unlimited links/mail; legitimate recovery succeeds after cooldown; alert fires on threshold fixture. |
| **W2-3 Release test gate** (I-02, PD-04) | QA + SRE · M | CI pins Supabase CLI, builds both images and runs seeded serial Playwright; role escalation, paid replay and restore proofs are linked in PR checklist. | A failing login→CSV→review→export fixture blocks PR; pinned-version and artifact checks pass on a clean runner. |
| **W2-4 Alerted operations** (I-03) | SRE · M | Named on-call receives alerts for stale heartbeat with pending work, oldest queue item, failed jobs, Storage cleanup and uncertain spend; readiness checks dependencies. | Kill one worker and break one dependency in staging; alerts arrive within the approved detection window and job completion latency is charted. |
| **W2-5 Bounded CSV lifecycle** (B-02, B-06, D-05) | Backend + DB · L | Parsing/Storage upload does not hold a long-lived row transaction; error report is complete and streamed or explicitly unavailable; staged rows follow an approved retention rule. | Large invalid CSV under concurrent workers shows bounded lock duration/memory, all error rows exactly once, and a timed purge or documented retained-row count. |
| **W2-6 Queue/report/rescore scale** (B-03, D-01, D-02) | DB + Backend · L | Claim, report and rescore paths meet a declared production-size latency/lock budget; until then, enforced job-size caps keep workloads inside measured safe range. | Repeat the 1M-opportunity `EXPLAIN ANALYZE` and concurrent rescore test; publish p95 claim/report time, max lock wait and accepted cap. |
| **W2-7 Review flow and state** (UX-01, UX-02, UX-05, O-03) | Product designer + Frontend · L | Active CSV/Results show progress and refresh; reports have retry/partial error state; review moves across pages without unsafe double decisions; Ready membership follows one recorded policy. | E2E slow/failing worker and DB cases plus a 50-item reviewer session record time per decision, stale-state detection and no lost/duplicate decisions. |
| **W2-8 Quality and outcome evidence** (P-02, PD-02, P-03, PD-01) | PM + Data lead · L | A versioned rubric and stratified real sample cover filtered/unchecked and two niches; activation/review events and a contacted→verified cohort have denominators and owners. | Blind holdout precision@20 and missed-good rate versus baseline, label agreement, and scored→contacted→verified conversion with elapsed time; do not claim link yield before follow-up matures. |
| **W2-9 Product and rule boundaries** (P-08, A-02, A-03) | Head of product + Staff engineer + Security · L | Supported release is explicitly one internal workspace, or org-scoped isolation is implemented before separate customers; an ADR assigns invariants to SQL and policy to Python/Next. | Cross-user/role and, if SaaS, cross-tenant RLS/RPC tests; owner-approved hosting, retention, scoring and tenant decisions; one cross-layer parity fixture. |
| **M2-1 Data rights and retention** (P-09, P-10, D-06, O-08, UX-11) | Privacy/product ops + DB + Security · M | Source/ToS review, contact-data scope, purge schedule and takedown path are recorded; scratch Admin SQL is removed from active guidance; privileged deletions have actor trail. | Ten-site/source review sample, deletion request drill, automated retention query, and role/blocklist audit-event assertions. |
| **M2-2 Review accessibility and responsive behavior** (UX-03, UX-06, UX-07, UX-08, UX-09, UX-10, O-13, P-07) | Designer + Frontend · L | Shortcuts ignore focused controls; dialog focus and mobile review pass WCAG checks; list caps are visible/paged; upload cap and ineffective controls match reality; locale scope is decided. | Keyboard/focus, contrast and 375px review e2e; seeded >500 users/jobs; 50–100 MiB upload boundary test; measured reviewer task time. |
| **M2-3 Security and API hardening** (S-03, S-04, S-05, D-07, B-10) | Security + Web + DB · M | Patched dependency, explicit headers, recent-auth password change rule, full-schema RLS inventory and request throttle on expensive endpoints. | Lockfile advisory gate, header/cookie probe, stolen-session simulation, catalog-generated RLS test and rate-limit load check. |
| **M2-4 Product economics and experiments** (P-01, P-05, P-06, PD-03, I-07) | PM + Data + Finance · M | Buyer/job-to-be-done and outcome metric are declared; cost sheet includes credits, bytes/compute and review time; filtered false negatives can be corrected; experiments have exposure/guardrails. | Five operator shadow sessions, two capped jobs reconciled to invoice, override audit test, and a predeclared small-cohort experiment readout. |
| **M2-5 Queue and schema housekeeping** (B-08, B-09, D-08, O-04, I-06, I-08) | Staff backend + DB + SRE · L | Poison work has delayed retry/operator lane; preview and worker planner share contract tests; placement job FK invariant is enforced; image/secret rotation and capacity rules are documented. | Poison-message replay, preview parity fixtures, DB mismatch rejection, pinned-image rebuild, secret rotation drill and measured queue age under N replicas. |
| **M2-6 Documentation and handoff** (O-05, O-06, O-07, O-09, O-10, O-11, O-12, P-11, PD-05, PD-06, A-01) | Engineering manager + Doc owners · M | Dated reports are labeled historical, dictionary/runbook match schema and code, final hosting decision is recorded, missing commands/references are repaired and every live guide has an owner/review date. | Fresh-clone onboarding run, runbook tabletop by an unfamiliar engineer, link/command check, and review of ADR supersession list. |

## 7. Docs and ADR update checklist

- [ ] Replace ADR 0011's “hosting later” with the approved topology, environment split, rollback, restore and alert owner; keep the untracked draft clearly provisional until reviewed (I-01, O-07, A-03).
- [ ] Mark ADR 0006 conceptual/superseded by ADR 0024 for persisted pipeline state; correct the data dictionary (O-06).
- [ ] Decide stable versus ranked Ready, then amend or supersede ADR 0023 and update queue UI/report denominators together (O-03).
- [ ] Amend ADR 0005 to say config history is immutable while derived scores may be explicitly rescored (`docs/adr/0005-config-versioning.md:3`; `apps/worker/src/worker/scoring/rescore.py:61-64`).
- [ ] Recover the “MVP plan section 0.5” or add the missing alternatives/reversal criteria to ADRs 0001–0010 (A-01).
- [ ] Add a business-rule boundary ADR for SQL invariants, Python policy and Next validation, including RPC compatibility (A-02).
- [ ] Amend ADRs 0004/0012 for `users.manage` Admin-equivalence or the new assignment ceiling, and document invite/reset service-key use (S-01, O-09).
- [ ] Amend ADR 0022 with real-label acceptance criteria, false-negative handling and the placement outcome feedback protocol (P-02, P-03, PD-02).
- [ ] Record supported single-team versus SaaS scope, source/ToS review, personal-data retention/deletion, and pricing/cost assumptions as short decisions (P-08–P-10, A-03).
- [ ] Correct `README.md`/product brief to distinguish prospect approvals, Used status and independently verified links; name buyer, operator, North Star and pilot stop rule (P-01, P-11).
- [ ] Correct `docs/testing.md`, `docs/development.md`, `CONTRIBUTING.md`, Makefile descriptions and PR Definition of Done to distinguish offline checks, DB-mutating tests and release gates (O-02, PD-05).
- [ ] Replace the dangerous manual SQL in `docs/runbooks/worker.md`; add DB, Serper, Storage, worker and host incident sheets with escalation and restore proof (I-04, I-05, D-04).
- [ ] Update `docs/data-dictionary.md` for CSV staging retention, current placements/crawl tables, upload limits and actual opportunity state; add a retention inventory (D-05, O-06, O-13).
- [ ] Label `docs/pre-m5-readiness-review.md` and `docs/qa-browser-report-2026-10-29.md` as historical snapshots; link current test/metric evidence instead of their old pass counts (O-05, O-10).
- [ ] Add an API/RPC reference, deployment/onboarding entry point, owner map, release notes and change log; remove or replace tracked Admin-promotion snippets (PD-06, O-08).

## Things I could not verify

- Whether any external production deployment, branch protection, paid-search invoice reconciliation, alert route, backup/restore drill, or security headers exist outside the tracked checkout (I-01, I-03, D-04, P-04, S-04).
- Real prospect precision, recall, reviewer speed, placement conversion, customer retention, provider cost per verified link, or legal rights for a specific site/source (P-02, P-03, UX-02, P-09/P-10, PD-01).
- The owner's intended production scope, staffing, budget, RPO/RTO or acceptable p95 latency. The phase times and proof thresholds must be approved against that scope; this document does not certify them.
- A fresh current CI run, live traffic load test, or deployment rollback. This synthesis read the nine audit reports and their cited source evidence; it did not change application code or invoke external systems.

## Questions for the owner

1. Is “production” a single trusted internal team or separate paying customer organizations? The latter makes P-08 a hard isolation gate.
2. Who owns the release decision, database/Storage restore, Serper account allowance, privacy/source review and scoring labels, with named backups?
3. What RPO/RTO, account spend ceiling, job-size cap and p95 job/report latency will be accepted before the first always-on deployment?
4. What real-label precision/recall and observed verified-link outcome are sufficient to claim product value?
5. Will the team staff the L workstreams in parallel, or should the production date move until the gates pass?
