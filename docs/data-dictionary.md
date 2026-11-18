# Data dictionary

Source of truth for schema is `supabase/migrations`. This file explains what
the columns mean and who may touch them. Update it in the same change as a
migration.

## M7-S1: feedback metrics

`job_queries` stores the stable query UUID, job, activity key, text template ID,
template version and expanded query text. Template IDs are scoped to an activity;
the report key is `activity_key/template_id` and combines template versions.
M8-S3 adds locale, paging, priority, status, attempt, lease and result fields.
The worker generates rows at pickup and increments `job_stats.queries_total` in
the same transaction. Identical text, locale, location, requested `num` and page
are unique per job. Users with `jobs.view` can read rows; only the worker may
insert them.
A Google `opportunity_sources.source_ref` is the query UUID as text;
reporting joins it only to a query in the same job.

The generator uses each selected activity's enabled templates, its saved
profile version and the job settings at pickup. It normalizes whitespace,
deduplicates requests, interleaves activities and templates on page 1, then
adds deeper pages only if budget capacity remains. `num` is 10 after the M8-S2
credit check. `gl` and `hl` use the job's country and language codes; the raw
city or region is sent as `location` and replaces `{city}`. Missing values skip
only templates that require them. The plan is capped at the smaller of the job
credit budget and 10,000 rows; exceeding that estimate writes a warning event.
Affordable pending query rows keep a running job from being marked complete. M8-S4 claims
queries with leases and records each Serper response through `record_discovery`.
It stores the provider-reported credits, organic result count and newly admitted
domains in the same transaction as the query completion and live counters. A
lost lease cannot publish a stale response. Expired claims retry up to the
configured attempt limit; a crash after a paid call but before commit can
re-spend that call on each retry. Provider-level transient retries may also
repeat a call. No credit is recorded without a response.

M8-S5 serializes claims across workers per job and permits at most two active
queries per job. The first claim reserves one credit, based on the M8-S2 calls;
later claims reserve at least the highest credit cost that job has reported.
No claim starts unless reported spend plus reservations fits the job budget.
Search publication takes the same job lock before it changes query status or
credits, including when a call returns zero organic results.
When spend reaches the budget, or the remaining balance cannot cover the next
reservation, pending query rows stay visible but no longer block completion.
Checks and running queries still drain; the job finishes with `budget_reached`.
If every query failed, the job becomes Failed with `all_queries_failed`.
If Serper charges more than the prior reservation, up to two in-flight calls
can overshoot by that price difference each. The two-credit fake-provider test
shows a maximum two-credit reported overshoot from the initial one-credit
reservation. A fixed hard ceiling is impossible for charges not reported after
a timeout or worker crash.

M8-S6 evaluates only completed Google query rows. After at least `saturation_n`
successful calls, it sums `new_unique_domains` from the latest N; a sum below
`saturation_x` moves a Running job with affordable pending queries to Saturated.
Failed rows do not enter the window, and `saturation_x=0` disables the rule.
Already running searches and opportunity checks finish while Saturated; new
search claims stop. Resuming sets a counter checkpoint so another saturation
decision waits for N more completed queries. A spent budget or an exhausted
query plan follows its normal completion or failure path instead of pausing
with no useful work left.

| `job_queries` field | Type | Meaning |
|---|---|---|
| id, job_id | uuid | Stable query ID and parent job; deleted with the job. |
| activity_key, template_id, template_version | text, text, integer | Template identity pinned when the job is picked up. |
| query_text, gl, hl, location, num, page | text, text, text, text, integer, integer | Exact Serper request parameters. `num` defaults to 10; pages start at 1. |
| priority, status | integer, text | Execution order and `pending`, `running`, `done` or `failed`. |
| attempts, locked_by, lease_expires_at | integer, text, timestamptz | S4 retry and lease state. A running row must have an owner and lease. |
| credits_used, result_count, new_unique_domains | integer | Nullable until a call completes; values cannot be negative. |
| error, completed_at | text, timestamptz | Failure and completion detail. |

The Queries tab pages through rows in execution order. `job_query_yield(job_id)`
groups query count, failures, reported credits, results and new domains by
activity and template version; domains per credit uses those sums. Users with
`jobs.control` may retry a failed row while its job can still spend credit. The
retry resets its attempts and lease, keeps past credit totals, and records an
audit event. A completed `drained` job or failed `all_queries_failed` job
reopens for this retry; stopped and budget-reached jobs stay closed.

`report_metrics(job_id)` returns an all-results summary, the Top-50 headline,
and source, query template, activity and score-tier groups. Null `job_id` combines all jobs by summing rows,
not by averaging job rates. Only reviewable Ready and Backlog rows enter the
report. The headline includes only immutable `first_ready_rank` 1–50, even when
the configured queue is larger. Approved and Used are successes; Rejected is a
failure; New and In review are undecided. Approval rate is success / decided,
null when decided is zero, rounded to four decimal places. `low_sample` is true
below 20 decisions. A row can contribute to more than one source or template
group, but only once within a group. Score tier uses `tier_at_review` for decided
rows, so later rescoring does not rewrite past decisions.

`report_reject_reasons(job_id)` counts live Rejected rows by current reason and
includes zero-count reasons. `report_review_throughput(job_id)` counts approval
and rejection transition events by UTC day, including another decision after a
reopen; marking Used is not another review. These event counts need not equal
current decided counts. All three functions require `reports.view` and return
aggregates through permission-checked definer functions; they do not grant
direct result or query access. Optional `from`, `to` and activity arguments
filter decisions by the latest approval/rejection day in UTC; undecided counts
remain the current stock. A Used row stays attributed to its approval day.
These are live current-state rates: reopening or changing a decision can change
an earlier period's rate. Throughput remains an event count.

M7-S2 presents these same metrics on the overall Reports page and each job's
Report tab. The date, job and activity filters also drive a CSV export of every
report table. The source-rate and daily-throughput charts repeat data from the
accessible tables.

## M7-S3: blocklist from review

`block_rejected_domain(job_id, result_id, domain, reason)` requires `jobs.view`,
`results.view`, and `blocklist.manage`. Callers supply either a rejected result
ID or a domain with a rejected result in that job. The function locks the live
rejection and inserts the global blocklist entry in one transaction. A duplicate
domain returns `already_blocked` without changing its existing reason or owner.
The entry records `source_job_id` and `added_by`. The review UI labels the
all-jobs scope and keeps a conditional Undo action in browser session storage;
Undo removes only the entry created by that user if its reason and source are
unchanged. Existing results retain their review decisions. The next discovery
of any new URL on the blocked domain is auto-filtered before fetching.

## M7-S4: review capture audit and retuning inputs

Run `psql "$AUDIT_DATABASE_URL" -X -f scripts/audit-review-capture.sql` with a
database role that can read every opportunity and its review history. The
read-only script disables row filtering and fails if the role has only partial
visibility. It exits nonzero if any current Approved, Rejected, or Used row
lacks a matching status-transition history event at `reviewed_at`, has a null
`score_at_review`, lacks decision-time scoring inputs, or has a score
snapshot that differs from that event. Rejected
rows must also have a reason and scope that match the event. It prints a count
and an example opportunity ID for each failure. A passing audit proves capture
completeness for live decided rows, not score accuracy or label quality.

| Field | Phase 2 interpretation |
|---|---|
| `opportunities.review_status`, `reject_reason`, `reject_scope` | Current label and scope. `used` follows an approval; it is not another independent approval label. Reopening removes the current decision, but earlier decisions remain in history. |
| `reviewed_at`, `score_at_review`, `tier_at_review` | Snapshot of the latest status decision. `used` refreshes these at the Used transition; use the earlier Approved history event for the approval-time score. Current `score` and `tier` can change on rescore. |
| `opportunity_reviews` | Append-only transition and metadata history, including score, tier, reason, scope, `config_version`, source summary, and external metrics as seen then. New decided transitions also freeze compact `scoring_inputs` (algorithm and policy versions, six component values, and unknown checks). Use status-changing Approved/Rejected events as labels, with an explicit policy for repeated decisions on one URL. |
| `job_config_history.snapshot.scoring`, `job_rescore_requests.scoring_snapshot` | Versioned initial and explicit rescore policies. `config_version` is pinned at discovery; after a rescore it alone does not identify the policy that produced a decision-time score. |
| `opportunity_checks`, `opportunities.score_breakdown` | Current check and score details. Check snapshots are replaced on rerun and the row breakdown can change on rescore. Use review-history `scoring_inputs` for decision-time weight retuning; full historical check evidence is not retained. |

New decisions require a score and a complete six-component breakdown. An
unscored filtered row cannot be approved, rejected, or marked Used; it may still
be viewed and have metadata edited. The migration does not invent scores or
reconstruct breakdowns for older decisions. The audit identifies those legacy
gaps for review, and Phase 2 must exclude them from weight retuning unless a
trusted original snapshot exists. The compact scoring inputs preserve the raw
component values needed to retune weights without duplicating the full scoring
explanation on every decision. Full raw-check retuning would require separate
decision-time check storage.
Review history also cascades on job deletion, so a training dataset needs a
separate retention decision before jobs are removed. Deploy the web UI support
before the database migration so reviewers see why unscored decisions are
blocked. A web rollback can keep the additive column and database guard; do not
drop captured snapshots as part of a rollback.

## M6-S1: review state and history

`opportunities.review_status` starts at `new` and can move through `in_review`,
`approved`, `rejected`, and `used`. `reviewer_id` retains the last actor's UUID;
`reviewed_at`, `score_at_review`, and `tier_at_review` are trigger-owned snapshots
of the latest decision. `notes` is limited to 4,000 characters. `external_metrics`
is an object limited to 16 KiB for externally verified metrics and activity
reviewer fields. `row_version` starts at zero and rises only when review state or
metadata changes; worker scoring and queue updates leave it alone.

A rejection requires `reject_reason`. `spam` has `global` scope, `off_topic` has
`niche` scope, and other reasons have `job` scope. `other` requires a nonblank
note. S5 synchronizes global spam and niche flags with live rejections.

`opportunity_reviews` stores one immutable snapshot per review status or metadata
change, including score, tier, config version, queue group, source summary, note,
and external metrics. Its trigger runs in the opportunity update transaction: an
audit insert failure cancels the review update. Only the trigger may insert;
clients with `results.view` may read history for the same opportunity rows they
can already see, including the `results.view_filtered` restriction. Direct review
writes remain closed to browser roles. Review history is retained for
the lifetime of the job and follows the existing job deletion cascade. Reviewer
UUIDs are not foreign keys so deleting an account does not erase audit identity.

## M6-S2: result browsing

`list_job_results` returns at most 51 rows for a 50-row keyset page. Default
order is score descending, then overlap descending, discovery time and UUID;
`newest` uses discovery time descending and UUID. The cursor is the last visible
opportunity UUID. `list_job_result_domains` groups matching rows by domain and
returns count, best score and three preview URLs; its cursor is the last visible
domain. Both functions accept queue, tier, activity, source, review status,
domain, search and flag filters. Search covers normalized URL and domain. The
default queue is Ready; null queue means All.

Both page functions require `results.view`. Auto-filtered rows require
`results.view_filtered`, including in All and grouped views. They run as definer
only after checking the caller's permissions; the private match function has no
browser execute grant. Newest and trigram search indexes support large jobs, while
the existing ranking and job-domain indexes support score pages and grouping.

## M6-S3: result detail and metadata

The row drawer reads one visible opportunity by job and UUID, then its complete
check snapshot and source records. Source pages are read in 1,000-row chunks;
evidence, scoring JSON, fetch summary, and redirect URLs are displayed as text.
External metrics use `dr` and `traffic` plus the row activity's configured
reviewer fields. Removing a value sends JSON null; the metadata RPC removes that
key while preserving other stored metrics.

`save_opportunity_metadata` requires `results.view` and `results.review`, and
`results.view_filtered` for an auto-filtered row. It locks the row, compares
`row_version`, validates bounded scalar metrics and notes, then updates only
changed metadata. The S1 trigger records each edit and its actor atomically.
The RPC returns `saved`, `stale`, or `missing`; direct browser table updates stay
closed.

## M6-S4: review decisions

`review_opportunities` is the only browser path for status changes. It requires
`results.view` and `results.review`, except reopening requires the separate
`results.reopen` permission. Admin has reopen by default; Manager does not.
The function locks selected rows in UUID order, checks all row versions and
legal transitions before writing any, and returns `stale`, `invalid_state`, or
`missing` without a partial decision. Bulk calls are limited to 50 rows and
only approve or reject; each selected row must already be `in_review`.

Transitions are `new` → `in_review` → `approved` or `rejected`, then
`approved` → `used`. An authorized reopen moves a decided row back to
`in_review`, clears the decision fields, and keeps notes. Rejection requires
one reason; `other` requires a new nonblank note. Decision notes append to
existing notes. The S1 trigger owns decision timestamps and score snapshots
and records every transition, including reopen. S5 applies spam and niche flags
in the same transaction as each decision. The domain spam flag stays set while
any spam rejection is live and clears when the last one is reopened.

`result_review_state` returns only row versions and claimant display names for
visible result IDs (at most 50). It never grants general profile-directory
access. The displayed claimant is the row's latest reviewer, a soft claim with
no ownership lock.

## M6-S7: results export

`export_result_batch` returns at most 500 matching opportunities per call in
UUID order. It reuses the Results filters and requires `jobs.view`,
`results.view`, and `results.export`; auto-filtered rows also require
`results.view_filtered`. The `(job_id, id)` index supports keyset pages.
The download route streams each batch into CSV with selectable columns,
including `dr`, `traffic`, and the complete `external_metrics` object.
Exporting a chosen review status searches all visible queues; Current filter
uses the on-screen queue and filters.
Every cell is quoted and cells beginning with a spreadsheet formula prefix
(including after whitespace) receive a leading apostrophe.

`log_result_export` checks the same base permissions and writes one
`results_export_started` event with the effective filters and selected
columns before the response streams. Export reads live rows, so concurrent
edits can change which rows match between batches.

## M1: identity

### `public.roles`
| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. Starter roles use fixed ids (`a0000000-...-0001` Admin, `-0002` Manager, `-0003` Viewer). |
| name | text | Required, not blank, unique ignoring case. |
| description | text | Optional. |
| is_system | boolean | Starter role. Cannot be changed after creation. |
| is_protected | boolean | Cannot be deleted and must keep `roles.manage` and `users.manage`. Only Admin. Cannot be changed after creation. |
| created_at, updated_at | timestamptz | `updated_at` maintained by trigger. |

Write rules: needs `roles.manage`. New roles cannot be system or protected.
Delete is blocked for protected roles and roles that still have profiles.

### `public.permissions`
| Column | Type | Meaning |
|---|---|---|
| key | text | Primary key, for example `jobs.view`. |
| group | text | Jobs, Results, Data or Admin. Used to group the role builder matrix. |
| description | text | Shown next to the checkbox. |

The catalog changes only through migrations. No client write is allowed, not
even for Admin. A migration that adds a permission must also grant it to
Admin.

### `public.role_permissions`
| Column | Type | Meaning |
|---|---|---|
| role_id | uuid | References `roles`, deleted with the role. |
| permission_key | text | References `permissions`, deleted with the permission. |

Primary key is both columns. On a protected role, `roles.manage` and
`users.manage` cannot be removed.

### `public.profiles`
| Column | Type | Meaning |
|---|---|---|
| id | uuid | Same as `auth.users.id`. Deleted with the auth user. |
| email | text | Lower-cased, unique ignoring case. Not editable from the client. |
| full_name | text | Display name. |
| role_id | uuid | Null while pending. Required once active. |
| status | `profile_status` | `pending`, `active`, `rejected`, `deactivated`. Only `active` users hold permissions. |
| approved_by, approved_at | uuid, timestamptz | Who approved the account and when. |
| created_at, updated_at | timestamptz | |

A profile is created automatically, as pending, when an auth user is created.
Inserts and deletes happen only through that trigger and the service key.
Clients may update `full_name`, `role_id`, `status`, `approved_by` and
`approved_at`, and only with `users.manage`. The last active Admin cannot be
deactivated, demoted or deleted.

### Functions
| Function | Who | What |
|---|---|---|
| `has_permission(key)` | signed-in | True when the caller is active and holds `key`. Used by every RLS policy. |
| `current_role_id()` | signed-in | The caller's role id when active, else null. |
| `save_role(id, name, description, keys[])` | `roles.manage` | Creates or updates a role and sets its exact permission set in one transaction. Runs as the caller, so RLS and guards apply. Null `id` creates. |
| `role_user_counts()` | `roles.manage` | Profiles per role, all statuses. Security definer so it sees every profile. |

### Error codes the app maps to messages
`lockout_protected_role`, `lockout_role_in_use`, `lockout_admin_permission`,
`lockout_last_admin`, `invalid_permission`, `role_not_found`, `forbidden`,
and unique violation `roles_name_lower_key`. See `apps/web/src/lib/db-errors.ts`.

## M2: jobs, activity profiles and the blocklist

Migrations: `20261010180900_m2_jobs_schema.sql` (tables),
`20261010181000_m2_jobs_rls.sql` (grants and policies),
`20261010190000_m2_job_lifecycle.sql` (versioning, events, state machine),
`20261010200000_m2_seed_activity_profiles.sql` (starter activities).

Clients never write `status`, `config_version`, `created_by` or the event and
history tables. Those change only through triggers and the lifecycle functions
below. Column-level grants enforce this, so a forgotten check in the app still
cannot break it.

### `public.jobs`
One backlink search for one client. Only `name` is required, so a Draft can be
saved half-empty. "Ready to start" is checked when the job starts, not by
`NOT NULL`.

| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. |
| job_type | text | Always `search_backlinks` in v1. |
| name | text | Required, not blank. |
| client, client_domain | text | Client name and its main domain. |
| target_urls | text[] | Client pages that backlinks should point to. |
| business_type, sub_niche | text | Free text. Business type is needed to start. |
| activity_keys | text[] | Keys of `activity_profiles` in scope. Checked at start, not by foreign key. |
| country | text | ISO 3166 alpha-2, upper case (`IN`). |
| language | text | ISO 639-1, lower case (`en`). |
| regions | text[] | Cities or regions. Feeds the `{city}` placeholder. |
| seed_keywords | text[] | Feeds the `{keyword}` placeholder. At least one is needed to start. |
| brand_variants | text[] | Brand spellings. Feeds `{brand}`. |
| competitor_domains, reference_sites | text[] | Discovery sources. Normalized domains. |
| seed_list_urls | text[] | The job's own list of pages to check. |
| banned_categories | text[] | Site categories to drop. |
| blocked_domains | text[] | Domains blocked for this job only. The global blocklist applies on top. |
| require_language_region_match | boolean | Drop pages whose language or region does not match. |
| budget_credits | integer | Serper credit budget, 0 or more. A source for starting when above 0. |
| pages_per_query | integer | 1 to 10. |
| saturation_n, saturation_x | integer | Saturation rule over the last `n` completed search queries; `x=0` disables it. |
| per_domain_cap | integer | Most pages kept per domain, 1 or more. |
| review_queue_size | integer | 1 to 500. |
| skip_previously_spam_domains | boolean | Skip domains rejected as spam in earlier jobs. |
| scrape_credit_cap | integer | Cap for the scrape fallback, 0 or more. |
| local_business | jsonb | Optional `{ name, address, phone }`. Stored only in v1. |
| status | `job_status` | See the state machine below. |
| status_reason | text | Why it was stopped or failed. |
| config_version | integer | Starts at 1. See versioning below. |
| started_at, finished_at | timestamptz | Set by the lifecycle functions. |
| created_by | uuid | Defaults to the caller. Not editable. |
| created_at, updated_at | timestamptz | `updated_at` is by trigger and is also the lost-update check in the app. |

Access: select with `jobs.view`; insert with `jobs.create`; update with
`jobs.edit`; delete with `jobs.delete`, and only when the status is not
`queued` or `running`. Finished jobs (`completed`, `failed`, `stopped`) are
read-only in the app.

#### State machine
| From | Action | To | Who |
|---|---|---|---|
| draft | start | queued | `jobs.start` via `transition_job` |
| queued | pick_up | running | worker via `worker_transition_job` |
| running | pause | paused | `jobs.control` |
| paused, saturated | resume | running | `jobs.control` (resuming Saturated needs confirmation in the app) |
| queued, running, paused, saturated | stop | stopped | `jobs.control` |
| running | complete | completed | worker |
| running | saturate | saturated | worker |
| queued, running | fail | failed | worker |

Thirteen legal moves in all. Anything else raises `invalid_transition`. The
same table is mirrored in `apps/web/src/features/jobs/rules.ts`, and the two
are kept in step by tests.

As of `20261025010000_atomic_job_import.sql`, the runner commits pickup and
gap/seed imports in one transaction. Queued remains visible until import
commits; transient errors roll pickup back. Non-transient import errors set
`status_reason = import_failed:<ExceptionClass>` and write the existing
`status_changed` event. No new state or columns were added. See ADR 0014.

#### Start readiness
`job_start_problems(job_id)` returns the reasons a job cannot start:
`missing_client_domain`, `missing_business_type`, `missing_country`,
`missing_language`, `missing_seed_keywords`, `no_activity`, `activity_unknown`,
`activity_disabled`, `no_source` (a source means budget above 0, seed list URLs
or competitor domains). `transition_job` refuses with
`job_not_ready:<codes>`. M4 will extend "source" to CSV uploads.

#### Config versioning
- While a job is Draft, edits do not change `config_version`.
- After leaving Draft, any real change to a setting adds 1 to `config_version`
  and writes a snapshot to `job_config_history`.
- A status change alone never bumps the version.
- Activity keys are compared sorted, so reordering is not a change.

### `public.job_config_history`
One snapshot per version, so a result can say which settings produced it.

| Column | Type | Meaning |
|---|---|---|
| job_id, version | uuid, integer | Primary key together. Deleted with the job. |
| snapshot | jsonb | The settings at that version. |
| changed_by, changed_at | uuid, timestamptz | Who and when. |

Read with `jobs.view`. Written only by trigger.

### `public.job_events`
Append-only activity log shown on the job's Activity tab.

| Column | Type | Meaning |
|---|---|---|
| id | bigint | Identity. |
| job_id | uuid | Deleted with the job. |
| type | text | Includes `created`, `edited`, `config_changed`, `status_changed`, and `results_export_started`. The UI words unknown types sensibly, so new ones are safe to add. |
| payload | jsonb | `created`: `{ name }`. `edited`: `{ fields: [...] }`. `config_changed`: `{ fields: [...], from_version }`. `status_changed`: `{ action, from, to, reason? }` (empty values are left out). |
| actor | uuid | Null for worker events. |
| config_version | integer | Version at the time. |
| created_at | timestamptz | |

Read with `jobs.view`. Written by triggers and permission-checked functions.
The actor's name comes from `profiles`, which only users with `users.manage`
can read, so other people see "A team member".

### `public.activity_profiles`
How to search for one kind of backlink and how to score what is found.

| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. |
| key | text | `^[a-z][a-z0-9_]{1,49}$`, unique. Cannot change after creation. Jobs refer to it. |
| name | text | Required, not blank. |
| enabled | boolean | Disabled activities cannot be chosen for new jobs. Jobs that already have one keep it. |
| footprint_templates | jsonb array | `{ id, template, language, priority, enabled }`. Placeholders `{keyword} {niche} {brand} {country} {city}`. `language` is `*` or an ISO 639-1 code. Priority 1 runs first. |
| page_type_signals | jsonb object | `{ url_patterns[], title_phrases[], heading_phrases[], body_phrases[], structure: { link_list, min_outbound_links } }`. |
| relevance_rule | jsonb object | `{ field_weights: { title, headings, meta, body }, min_score }`. Field weights 0 to 10, `min_score` 0 to 1. |
| scoring_weights | jsonb object | `{ relevance, language_region, activity_fit, overlap, multi_query, spam_penalty }`. The first five add up to 100. `spam_penalty` is a cap, not a part. |
| per_domain_cap | integer | 1 to 1000. |
| reviewer_fields | jsonb array | `{ key, label, type }` with type `text`, `number` or `url`. At most 12. |
| version | integer | Starts at 1. A trigger adds 1 only when something really changed, so a no-op save is not a new version. Scores record the version they used. |
| created_at, updated_at | timestamptz | |

Access: any active user can read (the job form needs the list). Insert and
update need `activities.manage`. There is no delete: disable instead. Clients
can write every column except `id`, `version` and the timestamps, and `key`
only on insert. The admin screen validates all the jsonb shapes; the database
checks only that each is an array or an object.

Seeded: `guest_post` and `resource_page`, with placeholder content that admins
refine in Admin > Activities.

### `public.blocklist`
Global list of domains no job returns results from. They are never fetched.

| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. |
| domain | text | Lower case registered domain, no scheme, path or spaces. Unique. Cannot change: remove and re-add instead. |
| reason | text | Optional, 200 characters in the app. |
| added_by | uuid | Defaults to the caller. |
| source_job_id | uuid | Job it was blocked from, if any. Set to null if the job is deleted. |
| created_at | timestamptz | |

Select, insert, update (reason only) and delete all need `blocklist.manage`.
People without it cannot see the list at all.

### Functions
| Function | Who | What |
|---|---|---|
| `job_start_problems(job_id)` | signed-in | Codes that block Start. Empty means ready. |
| `transition_job(job_id, action, reason)` | `jobs.start` for start, `jobs.control` for pause, resume and stop | The only way a user changes status. Checks the permission and the state machine, writes the event. |
| `worker_transition_job(...)` | service role only | pick_up, complete, saturate and fail. Never callable from a browser. |
| `job_config_snapshot(job)` | internal | Builds the snapshot stored in `job_config_history`. |
| `job_transition_target`, `job_apply_transition` | internal | The state table and the shared update. |

### Error codes the app maps to messages
`job_not_ready`, `invalid_transition`, `invalid_action`, `job_not_found`, and
unique violations `activity_profiles_key_key` and `blocklist_domain_key`.
See `apps/web/src/lib/db-errors.ts`.

---

## M3: pipeline backbone (URL rules, storage, worker engine)

Migrations: `20261013150133_m3_opportunities.sql` (opportunities, sources),
`20261013150144_m3_domains.sql` (domain cache),
`20261013150201_m3_stats_heartbeats_worker_role.sql` (job stats, heartbeats, worker role),
`20261013150257_m3_record_discovery.sql` (discovery recording),
`20261013155302_m3_discovery_flags.sql` (discovery flags),
`20261013164139_m3_job_engine.sql` (claim, lease, reap functions),
`20261014052928_m3_job_runner.sql` (job runner/orchestrator),
`20261014060702_m3_job_counters.sql` (live counters).

All tables are written only by the worker role (M0-D4). Clients may read
through RLS policies that check the permission catalog keys.

---

### `public.opportunities`
One discovered URL per job. Every URL is stored, including failed, skipped and
auto-filtered ones (I3). The worker normalizes URLs before inserting them.

| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. |
| job_id | uuid | References jobs. Deleted with the job. |
| original_url | text | The URL exactly as received. 1 to 4096 chars. |
| normalized_url | text | The canonical form the system uses. https only, <= 2100 chars. |
| host | text | Full host (lowercase, no www, IDN to punycode). |
| domain | text | Registered domain. Format: `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$`. |
| first_source_type | text | How this opportunity was first discovered: `google`, `competitor_csv`, `seed_list`. |
| found_by_count | integer | How many distinct sources found this URL. >= 1. |
| activity_key | text | Activity profile that this URL matches. Null until M5. |
| priority | smallint | Claim order: 0 = competitor CSV, 1 = seed list, 2 = google search (I6). |
| overlap_count | integer | Number of distinct competitor labels linking to this domain (G10). >= 0. |
| client_link_status | text | `unknown` or `known_partial`. GSC exports are partial, so some gaps may be false. |
| check_status | opportunity_check_status | Pipeline state: `pending`, `running`, `done`, `failed`, `skipped`. |
| check_reason | text | Why it failed or was skipped. Required when status is `failed` or `skipped` (I3). |
| locked_by | text | Worker id that currently claims this row. Null when not claimed. |
| lease_expires_at | timestamptz | When the current lease expires. Null when not claimed. |
| attempts | integer | How many times this row was claimed. >= 0. |
| queue_group | opportunity_queue_group | Review queue: `auto_filtered`, `ready`, `backlog`. Null until M5. |
| filter_reason | text | Why it was auto-filtered. Required when queue_group is `auto_filtered`. |
| score | numeric(5,2) | 0 to 100. Null until M5. |
| tier | opportunity_tier | `high`, `medium`, `low`, `unchecked`. Null until M5. |
| score_breakdown | jsonb | Component scores and reason codes. Null until M5. |
| config_version | integer | Job config version in force when discovered (A5, I8). >= 1. |
| fetch_summary | jsonb | Fetch outcome, redirects, final URL. Null until M5. |
| flags | jsonb | Domain-level flags. Default `{}` object. |
| extras | jsonb | Extra fields from CSV uploads or other sources. Default `{}` object. |
| duplicate_of | uuid | Points at the canonical row if this was merged (redirect/canonical). Null. |
| created_at, updated_at | timestamptz | |

Unique: `(job_id, normalized_url)`. The same URL may exist in different jobs (I7).
For a Google discovery, a confirmed client CSV makes `client_link_status`
`known_partial`. A valid client CSV row with the same registered domain sets
`flags.already_links_to_client=true`; the result remains eligible for checks and
review. This lookup currently reads `csv_rows`, so M9-S3 must preserve that
domain evidence before staging retention is enabled.

Indexes:
- `opportunities_claim_idx`: `(priority, created_at, id)` WHERE `check_status = 'pending'` - claim order
- `opportunities_lease_idx`: `(lease_expires_at)` WHERE `check_status = 'running'` - reaper
- `opportunities_ranking_idx`: `(job_id, queue_group, score desc nulls last, overlap_count desc, created_at, id)` - review queue order
- `opportunities_job_domain_idx`: `(job_id, domain)` - per-domain cap
- `opportunities_duplicate_of_idx`: `(duplicate_of)` WHERE `duplicate_of is not null`

Access: select with `results.view` and `results.view_filtered` for auto-filtered rows.
No client writes. Worker role has full access.

---

### `public.opportunity_sources`
Every source that found an opportunity. One row per (opportunity, source_type, source_ref).

| Column | Type | Meaning |
|---|---|---|
| opportunity_id | uuid | References opportunities. Deleted with the opportunity. |
| source_type | text | `google`, `competitor_csv`, or `seed_list`. |
| source_ref | text | google: query id. competitor_csv: competitor label. seed_list: any text. |
| found_at | timestamptz | When this source was recorded. |

Primary key: `(opportunity_id, source_type, source_ref)`.

Index: `opportunity_sources_ref_idx`: `(source_type, source_ref)` for reporting.

Access: select with `results.view`. No client writes.

---

### `public.domains`
Registered-domain facts and moderation metadata. `DomainFactsCache` reads only
snapshots whose `checked_at` is less than seven days old; missing/expired facts
return unknown. Robots policy lives in the separate origin table below.

| Column | Type | Meaning |
|---|---|---|
| registered_domain | text | Primary key; lowercase registered domain. |
| tld_flags | jsonb | Object containing observed TLD flags. |
| has_contact_page, has_about_page | boolean | Nullable observations; null means unknown. |
| checked_at | timestamptz | Timestamp of the complete facts snapshot. |
| last_fetch_status | text | Last recorded fetch outcome. |
| last_fetch_at | timestamptz | Last recorded fetch time. |
| global_spam | boolean | Domain-level spam warning. |
| global_spam_at | timestamptz | Time of spam flag. |
| global_spam_by | uuid | Profile recording spam. |
| global_spam_job_id | uuid | Job recording spam. |
| created_at, updated_at | timestamptz | Record timestamps. |
| robots_txt, robots_fetched_at | text, timestamptz | Legacy fields retained; unused by S2. |
| blocked_suspected, blocked_suspected_at | boolean, timestamptz | Legacy fields; unused by S2. |

Access: select with `results.view`; worker select/insert/update via RLS.
Facts writes preserve moderation fields.

### `public.domain_niche_rejections`
One private row per live `off_topic` rejection. Its `(domain, business_type,
sub_niche)` lookup key uses lowercase, trimmed, collapsed whitespace. The key
is captured when rejected, so later job edits cannot expand the rejection's
scope. Reopening deletes that row. No browser or worker role has direct table
access; review and discovery triggers manage it. Future discoveries in a
matching niche receive `flags.previously_off_topic` as an informational
snapshot. An esports rejection never flags a travel job.

### `public.origin_robots_cache`
Worker-only crawl policy cache (ADR 0018). No API-role table access or RPC execution.

| Column | Type | Meaning |
|---|---|---|
| origin | text | Primary key: scheme, full IDNA hostname, explicit effective port. |
| registered_domain | text | Nullable FK to domains; null for IPs/unknown suffixes. |
| state | text | `rules`, `absent`, or `unavailable`. |
| robots_txt | text | UTF-8 text, at most 524288 bytes; no page bodies. |
| fetched_at, expires_at | timestamptz | Refresh time and expiry, at most 24 hours. |
| refresh_token | uuid | Current refresh owner, cleared on completion. |
| refresh_until | timestamptz | Lease expires after 60 seconds. |
| blocked_until | timestamptz | Origin cooldown; never a permanent boolean ban. |

Worker access only through `worker_claim_robots`, `worker_complete_robots`, and
`worker_block_origin`. Expired leases can be reclaimed; stale completions fail.

---

### `public.job_stats`
Live counters for each job. Updated transactionally with the events that
change them (M3-S8, A9).

| Column | Type | Meaning |
|---|---|---|
| job_id | uuid | Primary key. References jobs. Deleted with the job. |
| credits_used | integer | Serper credits consumed. >= 0. |
| queries_total | integer | Total queries generated for this job. >= 0. |
| queries_done | integer | Successful queries with a stored provider response. Failed rows are excluded. >= 0. |
| saturation_recheck_after | integer | Next `queries_done` threshold after resuming a Saturated job. Starts at 0. |
| unique_opportunities | integer | Unique normalized URLs discovered. >= 0. |
| duplicates_skipped | integer | Duplicate URLs that were skipped. >= 0. |
| unchecked_count | integer | Rows that could not be checked (G12, I4). >= 0. |
| updated_at | timestamptz | When these counters were last updated. |

Access: select with `jobs.view`. Worker role has full access.

---

### `public.job_domains`
Domains discovered per job. Used for per-domain cap and saturation calculation.

| Column | Type | Meaning |
|---|---|---|
| job_id | uuid | References jobs. Deleted with the job. |
| domain | text | Registered domain. |
| first_discovered_at | timestamptz | When this domain was first found in this job. |
| last_discovered_at | timestamptz | When this domain was last found in this job. |

Primary key: `(job_id, domain)`.

Access: select with `jobs.view`. Worker role has full access.

---

### `public.worker_heartbeats`
Worker health monitoring (M3-S9). One row per active worker, refreshed every
15 seconds. A clean stop deletes the row.

| Column | Type | Meaning |
|---|---|---|
| worker_id | text | Primary key. Worker identifier. |
| host | text | Machine hostname. |
| started_at | timestamptz | When the worker started. |
| last_seen_at | timestamptz | When the last heartbeat was received. |
| current_job_id | uuid | Job the worker is currently processing, if any. Null until M5. |

Access: select with `system.view_health`. Worker role has full access.

---

### Functions

| Function | Who | What |
|---|---|---|
| `record_discovery(job_id, raw_url, normalized_url, host, domain, source_type, source_ref)` | worker | Inserts or updates an opportunity, adds source record, handles duplicates. Returns `(opp_id, created, source_added, domain_added)`. |
| `merge_opportunity_after_fetch(opp_id, final_url)` | worker | Merges rows when a redirect/canonical points to an existing opportunity. |
| `claim_opportunity_checks(worker_id, batch, lease_seconds)` | worker | Claims pending rows for processing using FOR UPDATE SKIP LOCKED (A2). Returns rows with lease. |
| `extend_opportunity_leases(worker_id, ids, lease_seconds)` | worker | Extends leases for rows the worker is still processing. |
| `release_opportunity_claims(worker_id)` | worker | Releases all claims held by a worker. |
| `reap_expired_leases(max_attempts, limit)` | worker | Returns expired leases to pending, marks failed after max_attempts. Returns `(requeued, failed)`. |
| `worker_pick_up_next_job()` | worker | Picks up the next queued job and transitions it to running. Returns `(job_id, outcome)`. |
| `worker_complete_drained_jobs()` | worker | Marks jobs as completed when no pending work remains. Returns array of completed job ids. |
| `update_job_stats(job_id, delta_credits, delta_queries_done, delta_uniq, delta_dups, delta_unchecked)` | internal | Updates counters transactionally. |

---

### Error codes the app maps to messages
Additional M3 error codes: `no_claimable_rows`, `lease_expired`, `max_attempts_exceeded`.
See `apps/web/src/lib/db-errors.ts`.


## M4: competitor gap (CSV)

Migrations: `20261015024143_m4_csv_schema.sql` (tables, RLS),
`20261015025911_m4_csv_storage.sql` (bucket, storage policies,
`discard_csv_upload`),
`20261016010000_m4_save_csv_mapping.sql` (`save_csv_mapping` RPC, validation, mapping persistence).

Files live in Storage. The worker parses them (ADR 0008) and stages one row
per CSV line. Clients never write status, counts, `file_info` or staged rows.

### `public.mapping_templates`
Saved column mappings, reusable across uploads.

| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. |
| name | text | Unique per kind, ignoring case. |
| kind | text | `competitor` or `client`. |
| mapping | jsonb object | See "Mapping contract" below. |
| shared | boolean | Visible to everyone with `csv.upload` or `mapping_templates.manage`. Otherwise only the creator. |
| created_by | uuid | Defaults to caller. |

Access: select needs `csv.upload` or `mapping_templates.manage`. Writes need
`mapping_templates.manage`.

### `public.csv_uploads`

CSV recovery migration `20261025020000_csv_claim_recovery.sql` adds:

| Column | Type | Meaning |
|---|---|---|
| locked_by | text, nullable | Owner of the current processing attempt. |
| claim_token | uuid, nullable | Fresh token per claim; guards staging and final writes. |
| lease_expires_at | timestamptz, nullable | Download claim expiry, renewed while downloading. |
| processing_attempts | integer, default 0 | Committed claims, including attempts lost to crashes. |

Ownership fields clear on Ready, Failed or requeue. Clients cannot write these
columns. Expired attempts return to Mapped until the configured maximum, then
become Failed with a reason. Staging locks the upload until rows and counts
commit. Error reports may include the claim token in their filename; clients
must follow `error_report_path`. Existing report paths remain valid. See ADR 0015.
One uploaded file for one job.

| Column | Type | Meaning |
|---|---|---|
| job_id | uuid | Deleted with the job. |
| kind | text | `competitor` or `client`. |
| competitor_label | text | Competitor registered domain. Required for competitor, null for client. G10 counts distinct labels. |
| filename, storage_path, size_bytes | | Storage path is unique. Size comes from Storage, not from the client. |
| status | `csv_upload_status` | `uploaded`, `mapped`, `processing`, `ready`, `confirmed`, `failed`, `discarded`. |
| status_reason | text | Why it failed or was discarded. |
| mapping, template_id | jsonb, uuid | Mapping used. Required from `mapped` onward. |
| file_info | jsonb | Worker findings, see "file_info keys". Empty object until the file is analyzed. |
| total_rows, valid_rows, invalid_rows, empty_rows | integer | Add up exactly when `ready` or `confirmed`. |
| duplicate_rows | integer | Repeats inside the file. A subset of valid rows. |
| error_report_path | text | Downloadable error CSV. |

Rules:
- One active file per (job, competitor label). A `failed` or `discarded` file does not block a re-upload (history kept, I3).
- Several client files per job are allowed. DEFAULT-ASSUMED (M4-P1).
- Upload is allowed only while the job is Draft. A client may edit `mapping` only while status is `uploaded`. Later moves go through a SQL function (M4-S4).
- Access: select needs `jobs.view`. Insert and mapping update need `csv.upload`.

#### Mapping contract (decided, built in M4-S4)
The database checks only that `mapping` is an object. The app and the worker
rely on this shape:

```json
{ "url_index": 1,
  "url_column": "Referring page URL",
  "columns": [ { "index": 0, "source": "Referring page title",
                 "label": "title", "type": "text" } ] }
```

- `url_index` (0-based) is the authority. Two columns can share a header text
  (`edge_duplicate_headers.csv`), so header text cannot pick a column.
- `url_column` is the display label (`CsvHeader.labels`, unique per file).
- Type is `text`, `number`, `date` or `ignore`.
- Saved templates match by header names, then resolve to an index per file.

#### `file_info` keys
Written by the worker from `CsvFormat.to_file_info()`
(`apps/worker/src/worker/io/csv_format.py`).

| Key | Meaning |
|---|---|
| encoding, bom, encoding_method | Detected encoding, BOM present, how it was found (`empty`, `bom`, `nul_pattern`, `utf8`, `charset_normalizer`, `cp1252`, `fallback`). |
| delimiter, delimiter_method, agreement | Chosen delimiter, how (`consistent_width` or `default`), share of non-blank sample records at the winning width (0 to 1). |
| header_line | 1-based PHYSICAL line where the header starts. Null when none found. |
| headers | Header text per column, as written (stripped). May hold `""` and repeats. |
| looks_like_data | Header record holds a URL-like cell, so the file may have no header. |

Detection reads the first 256 KB only. Known limits: non-Latin legacy
encodings are untested, a header after 200 records is not found, fixtures are
synthetic until real exports arrive (M4-PM1).

Lifecycle: `file_info` is written during the worker file ingestion run (when
an upload is `mapped` -> `processing`), or by a sample analysis call. The
mapping screen (M4-S4) reads headers from `file_info` or a sample stream.


### `public.csv_rows`
Staging, one row per CSV record, including empty and invalid ones.

| Column | Type | Meaning |
|---|---|---|
| upload_id, row_no | uuid, integer | Primary key. Deleted with the upload. `row_no` is the 1-based DATA record number: header and preamble are not counted, blank lines are counted as empty rows. |
| raw_url | text | As in the file, max 4096. |
| normalized_url, host, domain | text | Set when valid. Same shape rules as `opportunities`. |
| extras | jsonb object | Optional columns, keyed by mapping label. |
| is_valid, is_duplicate | boolean | Duplicate only for valid rows. |
| error_code | text | Required when invalid: `empty_row`, `bad_url`, `not_http`, `too_long`. |

The physical line is not stored. A quoted cell with a line break makes line
differ from `row_no + header_line`.

Access: select needs `csv.upload`. Worker writes. Purged after import is
confirmed (M9-S3).

### Storage bucket `csv-uploads`
Private. 100 MiB limit (same number as `apps/web/src/features/csv/limits.ts`).
Object name is `<job_id>/<upload_id>.csv`, fixed by a regex in the insert
policy. Insert needs `csv.upload` and a Draft job. Select needs `csv.upload`.
No client update or delete. The browser uploads directly. A `csv_uploads` row is
created only after the file exists, so a failed register can leave an orphan
object (sweep is a later step). Hosted free plan caps uploads at 50 MB.

### `public.csv_storage_cleanup`

Deleting a `csv_uploads` row queues its `storage_path` and `error_report_path`
here. `path` is the primary key; `job_id` and `upload_id` identify the deleted
upload, and `created_at` gates the worker's 30-second retry. These rows survive
job deletion and disappear only after Storage confirms removal. Users with
`csv.upload` can read pending rows; the worker and service role can delete them.

### Functions
| Function | Who | What |
|---|---|---|
| `discard_csv_upload(upload_id)` | `csv.upload` | Marks the upload `discarded`, deletes its staged rows. Draft jobs only. Refuses `processing`. Safe to retry. |
| `save_csv_mapping(upload_id, mapping, template_id)` | `csv.upload` | Validates mapping shape and negative index bounds, saves JSON mapping, links optional template, and transitions status from `uploaded` to `mapped`. Draft jobs only. Refuses `processing` or `discarded`. |

### Reader error codes (worker, `apps/worker/src/worker/io/csv_reader.py`)
| Code | Meaning |
|---|---|
| `empty_file` | 0 bytes. |
| `no_header` | Non-empty file, no header found (for example only blank lines). |
| `malformed_csv` | Broken quoting, or a field over 131072 characters. Rows before it were read. Rest of the file is lost. The upload must be marked `failed` with a visible reason (I3). |

### Error codes the app maps to messages
`upload_processing`, `job_not_draft`, `upload_not_found`, and unique violation
on one active file per competitor label. See `apps/web/src/lib/db-errors.ts`.

### `fetch_domain_limits`

Worker coordination only: `domain` (text primary key, registered-domain key) and
`next_allowed_at` (timestamptz, database-clock dispatch deadline). RLS enabled, no
API policies or direct worker writes. `worker_acquire_fetch_slot(text, double
precision)` grants a slot with zero or returns the remaining wait in seconds.
Only the worker role can execute it. See ADR 0016.


### `public.opportunity_checks` (M5-S3)

Latest complete raw-check snapshot, replaced atomically per opportunity.

| Column | Type | Meaning |
|---|---|---|
| opportunity_id | uuid | Parent opportunity FK; cascade delete. |
| check_key | text | Stable check identifier; composite PK with opportunity_id. |
| status | text | `pass`, `fail`, `could_not_check`. |
| reason_code | text | Stable identifier in the worker's reason catalog. |
| detail | text | Diagnostic detail, maximum 2,000 characters. |
| evidence | jsonb | Structured observations, object, maximum 16 KiB. No page bodies. |
| config_version | integer | Positive pinned opportunity config version. |
| checked_at | timestamptz | Database timestamp shared by every result in the snapshot. |

Authenticated SELECT requires `results.view` and parent opportunity visibility.
Worker SELECT is allowed; writes require `worker_save_opportunity_checks`, which
fences by owner, attempt, active lease and config version. A rerun removes omitted
checks; absent rows mean unexecuted, not passed. See [framework](check-framework.md).


### `public.domain_check_budgets` (M5-S5)

| Column | Type | Meaning |
|---|---|---|
| job_id, domain | uuid, text | Composite PK; job FK cascades. Domain is the registered-domain grouping. |
| cap_limit | integer | Positive effective cap frozen for this domain's first admission. |
| config_version | integer | Job snapshot used to choose the cap. |
| admitted_count | integer | Unique consumed admissions; retries never increment it again. |

### `public.opportunity_check_admissions` (M5-S5)

| Column | Type | Meaning |
|---|---|---|
| opportunity_id | uuid | PK and opportunity FK; one admission per URL. |
| job_id, domain | uuid, text | FK to the domain budget. |
| admitted_at | timestamptz | First-admission timestamp. |

Both tables have RLS and worker-only SELECT. Writes are internal to the claim RPC.
No browser access. Budget counts are not refunded for failures, releases or merges.
The config-history insert trigger records `activity_check_caps` as an object mapping
selected enabled activity keys to caps. Existing snapshots retain their original
values; see ADR 0020 for legacy behavior and the multi-activity maximum rule.


### M5-S6 opportunity filtering fields

`opportunities.filter_reason` is the stable exclusion code and `filter_detail` is
its persisted readable explanation (1–2,000 characters when present). Auto-filtered
rows require both fields. Discovery-time blocklist and skip-spam explanations are
filled by a trigger; leaving Auto-filtered clears the detail. Existing RLS/read
permissions apply. No browser write grants were added.

`worker_publish_check_filter` atomically saves the current check snapshot and
applies a worker-selected exclusion referencing a failed check. It reuses the S3
claim fence. Filtered rows finish with their lease released and score/tier cleared;
non-filtered rows remain claimed for scoring. See ADR 0021.

### M5-S7 scoring policy and requests

- `scoring_policy`: singleton operator-managed JSON configuration (version, default
  weights, High/Medium thresholds, diminishing-boost constants, spam signal cap).
  Browser and worker direct access is revoked; capture functions run as owner.
- `job_config_history.snapshot.scoring`: policy plus activity `{version, weights}`
  captured for new histories. Old histories stay immutable and use packaged v1
  defaults in initial scoring.
- `opportunities.score_breakdown`: object containing algorithm/check/policy/profile
  versions, effective weights, policy, component array, unknown essential checks,
  and top three catalog reason codes/text. `score` is rounded/clamped 0–100;
  Unchecked can have a numeric score but must rank below verified tiers in S8.
- `job_rescore_requests`: job, requester, immutable captured snapshot, pending/done/
  failed status, eligible-row count, error code, requested/finished timestamps.
  At most one pending request per job. Job deletion cascades request history.
- Job events `rescore_requested`, `rescore_completed`, `rescore_failed` record
  request IDs and completion counts; request failure preserves all old scores.

`request_job_rescore(job_id, confirmed)` requires jobs.view and jobs.rescore and
an idle completed/stopped job. `worker_next_rescore()` locks request/job until
commit. `worker_save_opportunity_score` fences initial scoring by claim and check
version. Browser roles cannot publish scores or forge/update request snapshots.

### M5-S8 queue membership

- `opportunities.queue_group`: `ready`, `backlog`, or `auto_filtered`. Existing
  Ready membership is never displaced by a higher score arriving later.
- `first_ready` and `first_ready_rank`: immutable membership/order for the job's
  first Ready cohort, used by G16. Later Ready replenishment and explicit Backlog
  releases do not enter that cohort.
- `worker_assign_opportunity_queue`: claim fenced worker function; assigns Ready
  while capacity exists, else Backlog, and finishes the check claim atomically.
- `release_backlog(job_id, limit=25)`: permission checked operation. Promotes only
  eligible undecided scored terminal rows up to free pending Ready capacity;
  Unchecked ranks after verified tiers. Audits the number released in
  `job_events.backlog_released`. Approved, Rejected, and Used Ready rows keep
  their queue history but no longer occupy a pending slot; reopening waits for
  capacity.
