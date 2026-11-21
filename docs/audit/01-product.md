# Product audit — 2026-11-17

## Executive summary

1. This is a prospect discovery and review tool for people doing backlink outreach for client websites, not an automatic link builder (`README.md:3-13`).
2. Its actual loop is job setup → CSV gap and optional paid search → page checks → score and queue → human decision → export; live-link verification is an optional later step (`apps/worker/src/worker/main.py:50-96`).
3. The likely operator is an SEO or outreach reviewer, but no named buyer, persona, or purchase decision is documented (`README.md:3-13`; `docs/backlink-quality-performance-plan.md:12-28`).
4. A product objective, measures, and release-specific non-goals exist; they are not a PRD, and the pilot has no human outcome labels (`docs/backlink-quality-performance-plan.md:12-28,96`; `docs/yogaban-prospect-review-worksheet.md:9-38`).
5. The score is deterministic and explainable, but its weights and thresholds have no demonstrated real-world precision (`apps/worker/src/worker/scoring/defaults.json:1-8`; `docs/testing.md:256-268`).
6. Approval and verified-placement records exist, yet no observed prospect-to-link conversion rate or score-to-placement calibration is established (`supabase/migrations/20261030010000_m7_report_metrics.sql:24-107`; `docs/backlink-quality-performance-plan.md:80`).
7. Search credits are counted and limited per job; aggregate user or organization spend, crawl bandwidth, compute, and human effort are not priced or capped (`supabase/migrations/20261010181643_m2_jobs_schema.sql:125-152`; `supabase/migrations/20261104060000_link_delivery_report.sql:48-66`).
8. The schema and permissions assume one shared internal team; external customer isolation, plans, and entitlements are absent (`supabase/migrations/20261008075408_m1_identity_schema.sql:6-53`; `supabase/migrations/20261010181654_m2_jobs_rls.sql:82-102`).
9. Robots controls exist, but provider rights, site terms, personal-data handling, and a real crawler contact identity still need an owner decision before external use (`apps/worker/src/worker/fetch/robots.py:102-143`; `apps/worker/src/worker/config/settings.py:34-44`).
10. Findings: **BLOCKER 0 · HIGH 4 · MEDIUM 7 · LOW 0**. Engineering milestones are ahead of evidence that users get valuable, compliant, affordable links (`docs/pre-m5-readiness-review.md:102-115`; `docs/backlink-quality-performance-plan.md:54-59,78-86`).

## Product and core loop inferred from implementation

**User and job to be done.** The code supports a person managing backlink prospecting for a client's site: find distinct external sites that might accept a relevant editorial link, spend reviewer time on the best candidates, then record whether a link actually went live. This is an inference from the client/job schema, reviewer permissions, and stated objective, not a validated persona or buyer definition (`supabase/migrations/20261010181643_m2_jobs_schema.sql:92-135`; `README.md:3-13`; `docs/backlink-quality-performance-plan.md:12-28`). The immediate output is a *prospect*. A placed and verified link is a different, later outcome (`supabase/migrations/20261104050000_link_placements.sql:4-34`).

| Step | What works in the repo | Product limit |
| --- | --- | --- |
| Import and gap | Users configure a client and job, upload competitor/client CSVs, map columns, and calculate competitor-minus-client domains (`README.md:7-10`; `supabase/migrations/20261023030000_m4_gap_calculation.sql:34-95`). | Real supplier export compatibility was outside the readiness proof (`docs/pre-m5-readiness-review.md:102,181-183`). |
| Search and crawl | Serper query planning and credit accounting are implemented; search is off by default. Depth-one site crawl exists and is also off by default (`apps/worker/src/worker/main.py:71-96`; `apps/worker/src/worker/config/settings.py:17-44`; `docs/backlink-quality-performance-plan.md:63-74`). | Paid-query yield and crawl gain have one narrow pilot and no labeled cross-niche result (`docs/backlink-quality-performance-plan.md:7-16,65`). |
| Checks and score | The worker fetches, checks, filters, scores, and queues candidates; essential unknown checks become `unchecked` (`apps/worker/src/worker/main.py:50-54`; `apps/worker/src/worker/scoring/engine.py:55-70,81-150`). | The score is a heuristic rank, not a conversion probability (`docs/backlink-quality-performance-plan.md:9,54-59`). |
| Review and export | Reviewers claim, approve, reject, and mark Used; reports aggregate approval by tier and source; CSV export exists (`supabase/migrations/20261028040000_m6_review_actions.sql:35-54,93-120`; `supabase/migrations/20261030010000_m7_report_metrics.sql:63-107`; `README.md:10-11`). | Auto-filtered false negatives cannot enter the normal scored-decision dataset; see P-06. |
| Placement and verification | Approved results can store manual outreach and a live source URL. A worker can verify the link; the worker is disabled by default (`supabase/migrations/20261104050000_link_placements.sql:4-34,60-128`; `apps/worker/src/worker/config/settings.py:43-44`). | No live Yogaban placement was submitted as of the last plan update (`docs/backlink-quality-performance-plan.md:80`). |

**What is stated.** The quality plan supplies a useful objective, qualified domains per credit, precision at 20, verified links, cost per verified link, and explicit non-goals (`docs/backlink-quality-performance-plan.md:12-28,96`). I found no consolidated PRD, named persona, pricing model, baseline conversion funnel, or declared North Star in `README.md`, `CONTRIBUTING.md`, and the tracked product docs (`rg -n 'PRD|persona|North Star|pricing|billing|subscription' README.md CONTRIBUTING.md docs --glob '!docs/audit/**'` returned no matches). That search does not rule out documents outside this repository.

## Milestones versus usable outcomes

| Label | Engineering evidence | Product sign-off still open |
| --- | --- | --- |
| M0–M4 | Identity, jobs, queue, CSV gap, and local tests are described as implemented in the 2026-10-25 readiness review (`docs/pre-m5-readiness-review.md:104-115`). | The same review excludes clean-clone deployment, remote CI, genuine provider exports, and full browser sign-off (`docs/pre-m5-readiness-review.md:95-102,179-184`). |
| M5 | The current worker wires `OpportunityHandler`; checks, filtering, scoring and queues exist (`apps/worker/src/worker/main.py:50-54`; `apps/worker/src/worker/scoring/engine.py:55-178`). | The older review's “handler intentionally unset” is historical, not current (`docs/pre-m5-readiness-review.md:115,188`). Real labeled ranking calibration remains open (`docs/testing.md:256-268`). |
| M6–M7 | Review actions, decision-time score capture, and approval reports exist (`supabase/migrations/20261028040000_m6_review_actions.sql:35-54`; `supabase/migrations/20261030030000_m7_review_scoring_capture.sql:22-56`; `supabase/migrations/20261030010000_m7_report_metrics.sql:24-107`). | The 24-page pilot worksheet has no completed PM labels, so approval quality is unmeasured (`docs/yogaban-prospect-review-worksheet.md:9-38`). |
| M8–M9 and later quality releases | Query plans, reported-credit budgets, CSV-only start repair, bounded crawl, placement records, and a delivery report exist (`apps/worker/src/worker/engine/queries.py:89-116`; `supabase/migrations/20261104010000_csv_start_guard.sql:1-61`; `supabase/migrations/20261104030000_focused_site_crawl.sql:1-17`; `supabase/migrations/20261104060000_link_delivery_report.sql:1-67`). | Search, crawl and link verification are off by default; labeled crawl gain, verified live-link yield, and outcome-based query ordering are not established (`apps/worker/src/worker/config/settings.py:17-44`; `docs/backlink-quality-performance-plan.md:65,80-86`). |

The readiness review is a dated development snapshot. Its B1–B6 closure and M5-S2 through S8 progress should not be read as current product launch approval. It explicitly excludes production and calibration, and its older CSV-only and handler gaps have since been changed in code (`docs/pre-m5-readiness-review.md:5,102,115,188-202`; `supabase/migrations/20261104010000_csv_start_guard.sql:1-61`; `apps/worker/src/worker/main.py:50-54`).

## Findings

### [P-01] No explicit buyer or product decision contract
- Severity: MEDIUM
- Type: GAP
- Area: Product
- Evidence: `README.md:3-13`; `docs/backlink-quality-performance-plan.md:12-28,90-96`; `docs/yogaban-prospect-review-worksheet.md:9-38`; `rg -n 'PRD|persona|North Star|pricing|billing|subscription' README.md CONTRIBUTING.md docs --glob '!docs/audit/**'` returned no matches.
- Why it matters: The objective and pilot measures exist, but the team cannot decide which user's workflow to optimize, what is out of scope for the whole product, or what outcome counts as launch success. A reviewer, buyer, and client may value different outputs.
- Recommendation: Write a one-page product brief naming buyer, daily operator, job to be done, target niche, primary outcome and threshold, non-goals, and pilot stop rule. Effort S.
- Confidence: High

### [P-02] Score quality is unproven on real prospects
- Severity: HIGH
- Type: RISK
- Area: Product
- Evidence: `apps/worker/src/worker/scoring/defaults.json:1-8`; `apps/worker/src/worker/scoring/engine.py:55-65,116-150`; `docs/testing.md:256-268`; `docs/yogaban-prospect-review-worksheet.md:9-38`; `docs/backlink-quality-performance-plan.md:54-59`.
- Why it matters: The 35/10/20/20/15 weights, spam penalty, and 70/40 thresholds encode a ranking judgment, not measured accuracy. The 0.739 precision figure comes from 23 ranked synthetic pages; real precision at 20, false-negative rate, and cross-niche stability are **UNVERIFIED**.
- Recommendation: Label 100–200 real pages across at least two niches, including filtered and uncertain pages; compare precision at 20 and missed viable sites against a simple baseline on a holdout before tuning thresholds. Effort M.
- Confidence: High

### [P-03] Placement outcomes are stored but do not close the score loop
- Severity: HIGH
- Type: GAP
- Area: Data
- Evidence: `supabase/migrations/20261030030000_m7_review_scoring_capture.sql:22-56`; `supabase/migrations/20261030010000_m7_report_metrics.sql:63-107`; `supabase/migrations/20261104050000_link_placements.sql:4-34`; `supabase/migrations/20261104060000_link_delivery_report.sql:13-67`; `docs/backlink-quality-performance-plan.md:80-86`.
- Why it matters: Approval by tier and verified links by query/client are separate aggregates. They do not report, for a scored cohort, how many prospects were contacted, how many converted to verified links, or precision of high scores against that outcome. With no live pilot placements, score-to-link conversion is **UNVERIFIED**.
- Recommendation: Record a small cohort funnel from score-at-review through contacted and verified, with denominators and elapsed time; calculate conversion by score band and compare it with reviewer approval before changing query order. Effort M.
- Confidence: High

### [P-04] Paid-search budget is local to a job, not an account spend limit
- Severity: HIGH
- Type: RISK
- Area: Product
- Evidence: `apps/web/src/features/jobs/schemas.ts:228-236`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:92-94,125-152`; `supabase/migrations/20261010181654_m2_jobs_rls.sql:87-94`; `docs/runbooks/worker.md:132-155`; `docs/serper-credit-verification.md:17-24`.
- Why it matters: A job is capped in the form at one million credits and the SQL reservation reduces reported overspend, but a user can create further jobs without a user/org allowance. Crashes and provider retries can also create charges outside the reported-credit bound; the provider balance was not independently reconciled in the documented three-call check. Paid search is off by default, so this becomes a spending risk when enabled.
- Recommendation: Before enabling paid search for more users, set an operator-owned monthly account ceiling and per-user/job approval threshold, reconcile provider usage, and alert on unexplained spend. Effort M.
- Confidence: High

### [P-05] “Cost per verified link” omits most unit costs
- Severity: MEDIUM
- Type: DOC-DRIFT
- Area: Product
- Evidence: `docs/backlink-quality-performance-plan.md:20-26`; `supabase/migrations/20261104060000_link_delivery_report.sql:48-66`; `apps/worker/src/worker/fetch/fetcher.py:369-395`; `supabase/migrations/20261015024143_m4_csv_schema.sql:86`; `apps/web/src/features/reports/report-panel.tsx:259-260`.
- Why it matters: The implemented report divides *Serper credits* by verified links. It does not convert credits to money or allocate fetch bandwidth, compute, storage, and manual review/outreach time per job, user, or organization. The plan's cost-per-link measure therefore cannot yet support pricing or margin decisions.
- Recommendation: Keep the current metric labeled “credits per verified link”; add one pilot cost sheet with provider invoices, job-level fetch/request totals, and manually sampled review/outreach time before setting a price. Effort S.
- Confidence: High

### [P-06] There is no normal correction path for filtered false negatives
- Severity: MEDIUM
- Type: GAP
- Area: UX
- Evidence: `apps/worker/src/worker/scoring/engine.py:67-70`; `supabase/migrations/20261028040000_m6_review_actions.sql:25-28,85-97`; `supabase/migrations/20261030030000_m7_review_scoring_capture.sql:35-49`; `docs/backlink-quality-performance-plan.md:54-59`.
- Why it matters: A privileged reviewer may see auto-filtered rows, but the scorer rejects them and the decision-capture trigger requires a score. The reviewer cannot record an ordinary approval for a viable filtered page; recall measurement and recovery of a useful lead are incomplete. The plan also says historical pages need a safe recheck path; rescoring alone reuses old evidence.
- Recommendation: Provide a narrowly scoped override/recheck action that records the original filter reason, fresh check evidence, and the human correction; include those corrections in recall evaluation. Effort M.
- Confidence: High

### [P-07] Job setup exposes controls with no current effect
- Severity: MEDIUM
- Type: IMPROVEMENT
- Area: UX
- Evidence: `apps/web/src/features/jobs/schemas.ts:228-239`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:129-135`; `apps/web/src/features/jobs/job-settings.tsx:125-133`; `rg -n 'scrape_credit_cap|local_business' apps/worker/src supabase/migrations apps/web/src --glob '!**/*.test.*' --glob '!**/database.types.ts'` found only storage, form, type and display references, with no worker consumer.
- Why it matters: “Scrape credit cap” implies a paid fallback that does not exist, and local-business details add data-entry and privacy surface without changing discovery, scoring, or reporting. These fields make setup longer and can give a false sense of protection.
- Recommendation: Hide the two fields from new-job setup until a real consumer and user flow exist; keep stored values readable for existing jobs. Effort S.
- Confidence: High

### [P-08] Internal-team permissions would expose customer jobs in a SaaS model
- Severity: HIGH
- Type: RISK
- Area: Product
- Evidence: `supabase/migrations/20261008075408_m1_identity_schema.sql:6-53`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:92-94,137-143`; `supabase/migrations/20261010181654_m2_jobs_rls.sql:82-111`; `supabase/migrations/20261104050000_link_placements.sql:50-58`; `docs/adr/0012-roles-manage-is-admin-equivalent.md:30-45`.
- Why it matters: Roles and permissions are global; `jobs.view` and `results.view` are not scoped to a creator or organization. This is coherent for one trusted internal team and unsafe for separate customer organizations. No plan, quota, entitlement, or billing entity exists in the examined schema. An external SaaS roadmap is **UNVERIFIED**.
- Recommendation: State “single internal workspace” as the supported product boundary now. If external customers are planned, add organizations and membership, tenant-scoped RLS/RPCs, quota and entitlement enforcement, and cross-tenant tests before onboarding them. Effort L.
- Confidence: High

### [P-09] Crawl and provider rights have no operational policy
- Severity: MEDIUM
- Type: GAP
- Area: Process
- Evidence: `apps/worker/src/worker/fetch/robots.py:102-143`; `apps/worker/src/worker/config/settings.py:34-44`; `docs/pre-m5-readiness-review.md:179-184`; `docs/backlink-quality-performance-plan.md:69-74,96`.
- Why it matters: The fetcher honors robots and throttling, but [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) says robots rules are not access authorization. The default bot identity still points to `example.com`; per-site terms and the Serper contract are not evaluated by code. Legality depends on source, jurisdiction, contract, and use; a violation is **UNVERIFIED**.
- Recommendation: Supply a real contact page, document allowed sources and prohibited collection, review the Serper agreement and representative site terms with counsel, and give operators a removal/complaint route before external crawling. Effort M.
- Confidence: High

### [P-10] Personal-data scope and retention are undefined
- Severity: MEDIUM
- Type: GAP
- Area: Data
- Evidence: `docs/data-dictionary.md:548-557,815-837`; `apps/worker/src/worker/checks/page.py:117-166`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:134-135`; `docs/qa-browser-report-2026-10-29.md:41-49`; `supabase/migrations/20261028040000_m6_review_actions.sql:99-102`.
- Why it matters: The worker detects contact-page presence but does not appear to extract people's contact details. CSV extras, free-text review notes, local-business phone, and stored source URLs can still contain personal data. Job deletion has cleanup, yet historical orphan Storage objects and the absence of a stated retention/erasure policy leave lifecycle duties unclear. If EU data is processed, [GDPR Articles 5, 6, and 14](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/) require attention to purpose, legal basis, minimization, and indirect-collection notice. India's [DPDP commencement notice](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) phases most substantive duties to May 2027; applicability here is **UNVERIFIED**.
- Recommendation: Map actual personal-data fields and jurisdictions, constrain unnecessary CSV extras/notes, set retention periods and data-subject handling, and test deletion across database, Storage, and exports. Effort M.
- Confidence: Medium

### [P-11] Engineering milestone names overstate product readiness
- Severity: MEDIUM
- Type: DOC-DRIFT
- Area: Process
- Evidence: `docs/pre-m5-readiness-review.md:5,102-115,175-202`; `apps/worker/src/worker/main.py:50-96`; `docs/backlink-quality-performance-plan.md:9-16,54-59,65,80-86`; `docs/testing.md:256-268`.
- Why it matters: M1–M9 labels and “implemented” statements describe slices of code, not a completed outreach outcome. The pre-M5 review is candid about its exclusions but contains now-stale forward-looking lines. Without a separate product gate, stakeholders can confuse worker wiring or fixture passes with validated relevance, conversion, economics, and production readiness.
- Recommendation: Add a current milestone ledger with separate columns for code complete, browser/deployment proof, real-data quality, cost, and customer outcome; mark the dated review archival. Effort S.
- Confidence: High

## Five riskiest assumptions and cheapest tests

| Assumption | Cheapest useful experiment | Decision signal |
| --- | --- | --- |
| The intended operator has a painful prospecting job and will use this workflow (P-01). | Shadow five real SEO/outreach operators for one campaign each; note their current inputs, review steps, and time to first qualified prospect. | At least three independently use the same core loop and name a measurable time or quality gain worth paying for. |
| High scores put viable sites ahead of noise (P-02, P-06). | Blind-label 100–200 existing pages from two niches, including filtered and unchecked rows; compare top-20 precision and recall with a simple keyword/overlap baseline. | Predeclare the pilot target from `docs/backlink-quality-performance-plan.md:59` and reject scoring changes that only improve the training sample. |
| Approved prospects turn into real links (P-03). | Track 20 manually approved prospects through contact, response, placement and independent live-link check; no automated outreach needed. | Report contact-to-verified and approved-to-verified conversion with denominators and time to placement. |
| Qualified prospects per paid credit can support a business (P-04, P-05). | Run two tightly capped jobs in different niches, reconcile Serper dashboard credits, and log fetch totals plus reviewer minutes in a sheet. | Compare fully loaded cost per approved domain and, when possible, per verified link with the buyer's willingness to pay. |
| One shared internal workspace is the intended market and its sources are usable (P-08–P-10). | Decide internal-only versus customer SaaS in one owner interview; review one real CSV and ten target sites for personal data, terms, and removal requests. | A signed product boundary and source/data policy; if SaaS is intended, make tenant isolation a release prerequisite. |

## Things I could not verify

- No production account, provider invoice, or Serper balance reconciliation was available; dollar cost per job and hidden provider charges are **UNVERIFIED** (`docs/serper-credit-verification.md:17-24`).
- No owner labels, placement cohort, or live outreach records were available in this read-only audit; real precision, recall, conversion, and crawl lift are **UNVERIFIED** (`docs/yogaban-prospect-review-worksheet.md:9-38`; `docs/backlink-quality-performance-plan.md:65,80`).
- The intended buyer, SaaS roadmap, prices, jurisdictions, actual customer data, Serper contract terms, and individual site terms are **UNVERIFIED**. Repository code cannot settle those decisions (`README.md:3-13`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:92-143`).
- I did not run a live crawl, paid search, deployment, or legal assessment. The compliance findings are product readiness questions, not a conclusion that current collection is unlawful (`apps/worker/src/worker/config/settings.py:17-44`).

## Questions for the owner

1. Is this a single-team internal tool, an agency workspace for multiple client accounts, or a customer-facing SaaS product? Who pays and who reviews daily?
2. What minimum gain over the current manual process justifies launch: qualified domains per credit, reviewer minutes saved, or verified links per campaign?
3. Who will label the first 100–200 real prospects and own the outreach/placement cohort, including false negatives?
4. What monthly Serper spend and crawl traffic are acceptable, and who can authorize an override?
5. Which countries, data sources, and outreach practices are in scope, and who owns provider terms, site complaints, retention, and deletion requests?
