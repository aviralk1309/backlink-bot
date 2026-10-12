# Data dictionary

Source of truth for schema is `supabase/migrations`. This file explains what
the columns mean and who may touch them. Update it in the same change as a
migration.

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
| saturation_n, saturation_x | integer | Saturation rule: if the last `n` queries found fewer than `x` new domains, the job pauses itself as Saturated. |
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
| type | text | `created`, `edited`, `config_changed`, `status_changed`. The UI words unknown types sensibly, so new ones are safe to add. |
| payload | jsonb | `created`: `{ name }`. `edited`: `{ fields: [...] }`. `config_changed`: `{ fields: [...], from_version }`. `status_changed`: `{ action, from, to, reason? }` (empty values are left out). |
| actor | uuid | Null for worker events. |
| config_version | integer | Version at the time. |
| created_at | timestamptz | |

Read with `jobs.view`. Written only by trigger and the lifecycle functions.
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