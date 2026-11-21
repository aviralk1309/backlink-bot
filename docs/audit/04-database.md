# Database audit

## Executive summary
1. **All 69 migrations replayed successfully** in a disposable Supabase project; the existing local database was not reset.
2. **All 52 pgTAP files passed** after reset: 1,197 assertions, with no failures.
3. The final schema has 31 public tables; every one has RLS enabled, and no public `SECURITY DEFINER` function lacks an explicit `search_path`.
4. No public table grants direct access to `anon`; authenticated, worker, and service-role access varies by table and is mapped below.
5. On one million synthetic opportunities, score/newest pages and exact URL dedupe used indexes and finished in under 0.3 ms.
6. The opportunity claim's pending-domain selection took about 499 ms while grouping 200,000 pending rows for one call (D-01).
7. `report_metrics` took 6.6 seconds and used temporary disk on the million-row job; dated review throughput scanned all 200,000 review events for one day (D-02).
8. Empty-database replay does not establish safe live upgrades: several migrations create indexes or validate constraints on hot tables and run data corrections in one transaction (D-03).
9. CSV staging rows, cache keys, stale heartbeats, and audit/event rows lack an effective retention plan; the dictionary's CSV purge claim is false (D-05, D-06).
10. Findings: **0 BLOCKER, 5 HIGH, 3 MEDIUM, 0 LOW**; backup/restore is a production gate (D-04), and schema/RLS gaps remain (D-07, D-08).

## Replay and test method

I copied `supabase/config.toml`, 69 migrations, and 52 SQL test files to `/private/tmp/backlink-db-audit-0gYpUu`, changed the temporary project ID and ports, then ran `supabase start`, `supabase db reset --local --no-seed`, and `supabase test db --local` against that project. Command output: reset applied through `20261104070000_link_observation_reset.sql` and ended `Finished supabase db reset`; tests ended `Files=52, Tests=1197 ... Result: PASS`. The temporary stack used port 55422. This proves **fresh replay on CLI 2.121.0/Postgres 17**, not an upgrade under live traffic. The repository's own default project was not reset.

The final schema query returned **31 public tables** and **69 applied migrations**. `pg_tables` reported `rowsecurity=true` for all 31. A `pg_proc` query for public `prosecdef` functions lacking a `search_path=` setting returned zero rows. All public timestamp columns are `timestamptz`; `placed_at` is intentionally `date` (`supabase/migrations/20261104050000_link_placements.sql:12-26`). The schema uses nine enums for stable workflow states, while lookup-like categories such as outreach and verification status use text with `CHECK`s (`supabase/migrations/20261104050000_link_placements.sql:8-14`). Draft job fields are intentionally nullable until start validation (`supabase/migrations/20261010181643_m2_jobs_schema.sql:97-163`; `supabase/migrations/20261104010000_csv_start_guard.sql:13-75`).

The migration history has **19/69 corrective follow-ons** under the counting rule already documented in `docs/audit/00-orientation.md:133-145` (O-04). The visible clusters include atomic import, CSV claim recovery, queue guards/enum casts, search claim fencing and uncertain spend, plus later start/crawl/observation corrections. The replay result does not erase that design churn: ownership, completion, credit reservation, and Ready-queue policy were settled after their first implementations (`docs/adr/0014-atomic-job-import.md:5-39`; `docs/adr/0015-csv-claim-recovery.md:5-42`; `supabase/migrations/20261027050000_m5_queue_enum_casts.sql:1-5`; `supabase/migrations/20261031030000_m8_search_claim_fence.sql:1-12`).

## Final-schema access matrix

This is **direct table access**, not every security-definer RPC. `R/C/U/D` mean SELECT/INSERT/UPDATE/DELETE grants *and* a matching RLS policy; an authenticated grant still requires the policy's permission predicate and, for some tables, parent-row visibility. `—` means no direct path. `service_role` bypasses RLS but still needs its listed ACL grant. `postgres`/object owners retain administrative access. Evidence: the disposable database's `pg_tables`, `pg_policies`, and `has_any_column_privilege`/`has_table_privilege` catalog queries; representative source policies are `supabase/migrations/20261010181654_m2_jobs_rls.sql:21-95`, `supabase/migrations/20261013150133_m3_opportunities.sql:178-205`, and `supabase/migrations/20261104050000_link_placements.sql:50-58`.

| Public table | Authenticated | Worker | Service role |
| --- | --- | --- | --- |
| `activity_profiles` | RCU | R | RCUD |
| `blocklist` | RCUD | R | RCUD |
| `csv_rows` | R | RCD | RCUD |
| `csv_uploads` | RCU | RU | RCUD |
| `domain_check_budgets` | — | R | — |
| `domain_niche_rejections` | — | — | — |
| `domains` | R | RCU | RCUD |
| `fetch_domain_limits` | — | — | — |
| `job_config_history` | R | R | RCUD |
| `job_domains` | R | RC | RCUD |
| `job_events` | R | RC | RCUD |
| `job_queries` | R | RCU | — |
| `job_rescore_requests` | R | RU | — |
| `job_stats` | R | RU | RCUD |
| `job_storage_cleanup` | — | RD | RCUD |
| `jobs` | RCUD | R | RCUD |
| `link_placement_events` | R | — | — |
| `link_placements` | R | — | — |
| `mapping_templates` | RCUD | R | RCUD |
| `opportunities` | R | RCU | RCUD |
| `opportunity_check_admissions` | — | R | — |
| `opportunity_checks` | R | R | — |
| `opportunity_reviews` | R | — | — |
| `opportunity_sources` | R | RC | RCUD |
| `origin_robots_cache` | — | — | — |
| `permissions` | R | — | RCUD |
| `profiles` | RU | — | RCUD |
| `role_permissions` | RCUD | — | RCUD |
| `roles` | RCUD | — | RCUD |
| `scoring_policy` | — | — | — |
| `worker_heartbeats` | R | RCUD | RCUD |

No public table had an effective anonymous grant in the catalog query. Three trigger functions still have default anonymous `EXECUTE` (`handle_new_user`, `guard_profiles`, `jobs_log_changes`), but PostgreSQL trigger functions cannot be called as ordinary RPCs; this is unnecessary privilege surface rather than a proven data leak. Tables closed to direct application access are reached through owner-controlled functions, for example the robots cache and placement writer (`supabase/migrations/20261026010000_m5_origin_robots_cache.sql:15-76`; `supabase/migrations/20261104050000_link_placements.sql:60-128`).

## Index and query-path review

I inserted **1,000,000 synthetic opportunities**, **1,000,000 source rows**, and **200,000 review-history rows** in the disposable database, then ran `ANALYZE` and read-only `EXPLAIN (ANALYZE, BUFFERS)`. The synthetic job has 100,000 Ready rows, 200,000 pending checks, and 10,000 domains. Timings depend on hardware/cache; they establish plan shape and an order of magnitude, not a production SLA.

| Hot path | Index / plan observed | Measured result |
| --- | --- | --- |
| Score-sorted results page (`supabase/migrations/20261028020000_m6_results_screen.sql:89-107`) | `opportunities_ranking_idx` index-only scan (`supabase/migrations/20261013150133_m3_opportunities.sql:139-143`) | 51 rows, **0.217 ms**. |
| Newest results page (`supabase/migrations/20261028020000_m6_results_screen.sql:108-121`) | `opportunities_result_newest_idx` index-only scan (`supabase/migrations/20261028020000_m6_results_screen.sql:2-3`) | 51 rows, **0.107 ms**. |
| Domain grouping (`supabase/migrations/20261028020000_m6_results_screen.sql:161-174`) | `opportunities_job_domain_idx` scans by job/domain, then filters queue (`supabase/migrations/20261013150133_m3_opportunities.sql:145-147`) | First 51 groups, **46.775 ms**, 44,200 rows removed by queue filter. Bounded 51 preview subqueries follow in the RPC. |
| Exact dedupe (`supabase/migrations/20261013150257_m3_record_discovery.sql:79-86`) | Unique `(job_id, normalized_url)` | One row, **0.170 ms**. |
| Pending-domain claim selection (`supabase/migrations/20261026030000_m5_domain_check_caps.sql:99-120`) | `opportunities_job_open_idx` scans 200,000 pending rows, hashes 2,000 domains, then top-N sorts; `opportunities_domain_pending_rank_idx` does not satisfy the grouped minimum-priority order | First 100 domains, **499.294 ms**. See D-01. |
| Search-query claim (`supabase/migrations/20261031020000_m8_saturation.sql:95-125`) | `job_queries_claim_idx(priority,id) WHERE pending` plus separate `job_queries_job_idx(job_id)` (`supabase/migrations/20261030040000_m8_query_plan.sql:32-38`; `supabase/migrations/20261030010000_m7_report_metrics.sql:15`) | No million-query fixture; combined per-job/priority plan **UNVERIFIED**. |
| All/job report metrics (`supabase/migrations/20261030010000_m7_report_metrics.sql:42-107`) | Function materializes eligible rows and performs repeated source/query joins | Full RPC: **6,616 ms**, 5.4 million shared-buffer hits, 29,045 temporary blocks read. See D-02. |
| Date-filtered review throughput (`supabase/migrations/20261030010000_m7_report_metrics.sql:141-169`) | Parallel sequential scan of `opportunity_reviews`; existing index starts with `opportunity_id` (`supabase/migrations/20261028010000_m6_review_schema.sql:57-58`) | One day from 200,000 events: **45.878 ms**, 199,452 rows rejected by date filter. See D-02. |

Trigram indexes exist for URL and domain substring search (`supabase/migrations/20261028020000_m6_results_screen.sql:4-7`). The domain cap lookup has a `(job_id, domain, overlap_count, created_at, id)` partial index (`supabase/migrations/20261026030000_m5_domain_check_caps.sql:53-55`); the claim RPC adds a correlated Google-source count to its ordering, so that last sort is not wholly index-ordered (`supabase/migrations/20261026030000_m5_domain_check_caps.sql:112-120`). I did not extrapolate a measured cost for source-filter or trigram searches from the synthetic data.

## Growth, integrity, and dictionary checks

Hard deletion of a job cascades through opportunities, CSV uploads/rows, queries, review history, job events, checks, sources, and placements (`supabase/migrations/20261010181643_m2_jobs_schema.sql:177-205`; `supabase/migrations/20261013150133_m3_opportunities.sql:41-43,161-170`; `supabase/migrations/20261015024143_m4_csv_schema.sql:77-83,182-188`; `supabase/migrations/20261104050000_link_placements.sql:4-7,37-40`). That keeps relational rows from orphaning but also deletes audit/training evidence; P-10 already raises the retention/product decision. `created_by` and several actor FKs use `ON DELETE SET NULL`, so deleting a profile also removes direct attribution from live rows (`supabase/migrations/20261010181643_m2_jobs_schema.sql:141-142,181-196`). `opportunity_reviews.reviewer_id` deliberately has no FK to preserve that UUID (`docs/data-dictionary.md:172-180`).

The data dictionary calls migrations the source of truth (`docs/data-dictionary.md:1-5`) but names four nonexistent M2 migration files (`docs/data-dictionary.md:322-327`), omits the current `job_storage_cleanup`, `link_placements`, and `link_placement_events` tables, and still describes only three opportunity source types after `site_crawl` was added (`docs/data-dictionary.md:517-571`; `supabase/migrations/20261104030000_focused_site_crawl.sql:4-10`). O-06 already records that general drift. Its specific claim that `csv_rows` is purged after confirmed import is contradicted by the actual deletion paths (D-05). Both committed `supabase/snippets/Untitled query *.sql` files are identical direct Admin-promotion updates containing a real personal email and the fixed Admin role UUID, with no password/API key; O-08 already records the risk (`git ls-files supabase/snippets`; `supabase/snippets/Untitled query 331.sql:1`; `supabase/snippets/Untitled query 859.sql:1`).

## Findings

### [D-01] Opportunity claiming repeatedly groups the whole pending job
- Severity: HIGH
- Type: RISK
- Area: DB
- Evidence: `supabase/migrations/20261026030000_m5_domain_check_caps.sql:80-120,139-147`; `supabase/migrations/20261014052928_m3_job_runner.sql:28-31`; `supabase/migrations/20261026030000_m5_domain_check_caps.sql:53-55`; disposable `EXPLAIN ANALYZE`: 200,000 pending rows scanned, 2,000 domains hashed, first 100 groups returned in **499.294 ms**.
- Why it matters: **Will break at scale.** Every small claim batch can re-evaluate the pending domain frontier while holding the job admission lock. A large job spends database time grouping rows instead of dispatching checks, and replicas cannot help the same job during that lock.
- Recommendation: Materialize per-job/domain pending priority and counts, or redesign the claim to read an index-ordered frontier; benchmark the full RPC at million-row scale before increasing worker replicas. Effort L.
- Confidence: High

### [D-02] Reports scan and rejoin too much history
- Severity: HIGH
- Type: RISK
- Area: DB
- Evidence: `supabase/migrations/20261030010000_m7_report_metrics.sql:42-107,141-169`; `supabase/migrations/20261028010000_m6_review_schema.sql:57-58`; disposable `EXPLAIN ANALYZE`: `report_metrics` **6,616 ms**, 5.4 million shared-buffer hits, temporary disk I/O on 1M opportunities/1M sources; one-day review throughput parallel-scanned 200,000 events and filtered 199,452.
- Why it matters: **Will break at scale.** A routine report takes seconds without competing users or workers, and a narrow day filter still reads all review history. The report export runs several aggregate RPCs concurrently, multiplying pressure.
- Recommendation: Rewrite the date predicate as half-open `timestamptz` bounds and index it; reduce repeated source joins through bounded preaggregation or maintained summaries, then set a measured report latency budget. Effort L.
- Confidence: High

### [D-03] Later migrations are not safe online upgrades on large tables
- Severity: HIGH
- Type: RISK
- Area: DB
- Evidence: `supabase/migrations/20261026030000_m5_domain_check_caps.sql:43-55` backfills admissions and builds an index; `supabase/migrations/20261028020000_m6_results_screen.sql:2-7` builds B-tree/GIN indexes without `CONCURRENTLY`; `supabase/migrations/20261028010000_m6_review_schema.sql:8-37` adds validated checks/defaulted columns; `supabase/migrations/20261031060000_m9_filter_search_redirects.sql:4-35` and `supabase/migrations/20261031080000_m9_correct_legacy_search_yield.sql:7-27` correct existing rows. Empty replay passed; no populated upgrade rehearsal was found.
- Why it matters: **Missing for production upgrades.** These DDL and backfill operations can block writers or hold large transactions while a live worker is using the same tables. A clean reset tests syntax/order, not lock duration, worker compatibility, rollback, or partially applied rollout behavior.
- Recommendation: Rehearse migrations on a production-sized copy with workers running; use expand/contract releases, concurrent indexes outside transactional migration batches, bounded backfills, and explicit rollback/compatibility gates. Effort L.
- Confidence: High

### [D-04] Backup and restore are neither specified nor tested
- Severity: HIGH
- Type: GAP
- Area: Reliability
- Evidence: `docs/pre-m5-readiness-review.md:184` calls a backup/restore plan a pre-production task; `deploy/production/README.md:78-87` only says to keep a current backup; `rg -n -i 'backup|pitr|restore|rpo|rto' docs README.md deploy supabase` found no RPO/RTO, restore runbook, or restore test. O-07 already covers the unsettled hosting decision.
- Why it matters: **Missing for production.** A successful migration reset is not a recovery drill. Without a tested database-plus-Storage restore and stated recovery targets, accidental deletion or a bad migration can cause unbounded downtime or permanent loss of uploaded evidence.
- Recommendation: Assign backup ownership, set RPO/RTO, document database/PITR and Storage coverage, and restore a backup into an isolated environment on a schedule before production use. Effort M.
- Confidence: High for repository evidence; production backup state is UNVERIFIED

### [D-05] CSV staging rows are retained despite the dictionary's purge claim
- Severity: HIGH
- Type: DOC-DRIFT
- Area: Data
- Evidence: `docs/data-dictionary.md:815-831` says `csv_rows` is purged after confirmed import; `supabase/migrations/20261015024143_m4_csv_schema.sql:182-223` creates persistent rows/indexes; `apps/worker/src/worker/io/csv_validator.py:245-250` deletes only on reprocessing; `supabase/migrations/20261015025911_m4_csv_storage.sql:75-86` deletes on discard; `rg -n 'delete from public.csv_rows' supabase/migrations apps/worker/src/worker` found no post-import purge.
- Why it matters: **Broken now and grows at scale.** Confirmed uploads can leave up to two million staged rows each until the upload or job is deleted. Operators relying on the dictionary will underestimate storage/index growth and may assume raw CSV-derived data has been erased.
- Recommendation: Decide whether CSV rows are needed after import and for how long; either implement a post-import purge with a tested preview/report replacement, or correct the dictionary and set a retention/archive policy. Effort M.
- Confidence: High

### [D-06] Cache keys and crash-stale heartbeat rows have no retention
- Severity: MEDIUM
- Type: GAP
- Area: DB
- Evidence: `supabase/migrations/20261025030000_fetch_rate_limits.sql:2-5,24-35`; `supabase/migrations/20261026010000_m5_origin_robots_cache.sql:3-14,18-39`; `supabase/migrations/20261013150201_m3_stats_heartbeats_worker_role.sql:68-83`; `apps/worker/src/worker/engine/heartbeat.py:25-36`; `docs/adr/0016-shared-fetch-budgets.md:51` explicitly defers domain-row cleanup.
- Why it matters: **Will break at scale.** Each new domain/origin leaves a persistent limiter or robots row; a killed worker leaves a heartbeat because graceful deletion never runs. Jobs, queries, event logs, and review/placement history likewise have no age-based archival while the job lives.
- Recommendation: Set retention windows, periodically remove expired/idle cache and stale heartbeat rows, and define job-history archival separately from hard deletion; monitor cardinality first. Effort M.
- Confidence: High

### [D-07] The named RLS matrix does not cover the final schema
- Severity: MEDIUM
- Type: GAP
- Area: Security
- Evidence: `supabase/tests/database/030_rls_matrix.test.sql:30-62,64-220` tests M1 identity/roles/profiles only; the final catalog contains 31 public tables; `supabase/tests/database/116_link_placements.test.sql:95-105` checks RPC grants but has no negative direct-table read case; catalog query found all 31 RLS-enabled and zero public definers without a pinned path.
- Why it matters: **Missing for production assurance.** The current suite passes, but a new table or grant can expose data while the specifically named matrix remains green. Feature tests cover selected permissions, not an exhaustive table-by-role contract.
- Recommendation: Add one catalog-driven test that enumerates every public table and expected anon/authenticated/worker/service grant and RLS policy, plus targeted negative row-visibility probes for new data tables. Effort M.
- Confidence: High

### [D-08] Placement job ID is independent of its opportunity's job
- Severity: MEDIUM
- Type: GAP
- Area: DB
- Evidence: `supabase/migrations/20261104050000_link_placements.sql:4-7,60-115`; `supabase/migrations/20261104060000_link_delivery_report.sql:2-47`; rollback-only SQL probe in the disposable database inserted a placement whose `opportunity_id` belongs to job A and whose `job_id` belongs to job B; the join returned `p.job_id <> o.job_id = true`.
- Why it matters: **Current integrity gap.** The app's writer copies the correct job ID today, but the schema does not enforce it. A future RPC, migration, or privileged repair can misattribute a placement and its delivery metrics to another job without a constraint error.
- Recommendation: Enforce `(opportunity_id, job_id)` with a composite FK/unique key, or remove the redundant `job_id` and derive it through the opportunity in reports. Effort M.
- Confidence: High

## Things I could not verify

- Production deployment, actual backups/PITR, Storage snapshot coverage, RPO/RTO, and restore success are **UNVERIFIED** without infrastructure access and a witnessed restore drill.
- The synthetic dataset used one large job and regular domain/status distributions. Real skew, concurrent workers, cache warmth, network latency, and multi-job report load may change timings; the plan shapes and cited row counts are reproducible in the disposable fixture.
- I did not run an online upgrade from a populated previous release or take lock-wait measurements during DDL. D-03 is based on the migration operations and PostgreSQL lock behavior, not a measured production incident.
- Effective permissions in a deployed Supabase project can drift through manual grants or policy changes; the access matrix is the clean-replay schema only.

## Questions for the owner

- Is there a production database today, and who owns its database and Storage backups, RPO/RTO, and restore drills?
- What maximum job, CSV, and review-history sizes should the query and retention design support?
- Are `csv_rows` deliberately retained for later gap preview/audit, or should they be purged after successful import?
- Will migrations ever run against a live worker fleet, and what maintenance window or dual-version compatibility is required?
