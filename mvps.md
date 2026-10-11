# Backlink Discovery Bot: MVP Breakdown and Task Plan

Source: *Product Overview v2 (revised)* in `README.md`. This plan splits the product into 11 MVPs (M0 to M10). Each MVP has build tasks (S-tasks) that an LLM agent or developer can pick up, and a separate block of human-owned decisions and manual work.

**Note:** This document and `README.md` should be kept in sync. When requirements change in one, update the other accordingly.

---

## 0. How to use this plan

### 0.1 Task ID and owner conventions

| Tag | Meaning |
|---|---|
| `M3-S4` | MVP 3, build task 4. Safe for an LLM agent or developer to implement. |
| `M3-D1` | **Developer decision.** Technical choice. A default is given. Record the final choice as an ADR. |
| `M3-DM1` | **Developer manual work.** Accounts, keys, servers, anything an agent cannot do. |
| `M3-P1` | **Product team decision.** Business choice. A default is given so work is not blocked. |
| `M3-PM1` | **Product team manual work.** Data, lists, samples, labelling, sign-off. |
| `G7` | Spec gap found while splitting (Section 2). Default given. Needs product confirmation. |

### 0.2 Rules for LLM agents and teams

1. Take one S-task at a time. Check its `Needs` line first. Do not start if a needed task or human item is open.
2. Never decide a `-P` item yourself. Use the stated default, mark it `DEFAULT-ASSUMED` in code comments and the PR, and continue.
3. Every task ends with its `Done when` checks passing, tests included. No task is finished without tests.
4. Config is data, not code: scoring weights, thresholds, keyword lists, footprint templates, caps and TTLs live in the DB or config files. Never hard-code them.
5. Do not add paid services. The only paid service is Serper (see invariant I1).
6. Any deviation from a default needs an ADR in `docs/adr/`.

### 0.3 Definition of Done (every S-task)

- Code merged, lint, type-check and tests green in CI.
- New tables have migrations, RLS policies and an RLS test.
- New worker logic has unit tests, and integration tests where it touches the DB.
- User-visible behavior has an empty state, an error state and a loading state.
- Reason codes added to the reason-code catalog (M5-S3) where relevant.
- Docs updated: data dictionary and, if behavior changed, the user guide.

### 0.4 Target repository layout

```
/apps/web                 Next.js dashboard (TypeScript)
/apps/worker              Python bot (workers)
/supabase/migrations      SQL migrations (source of truth for schema)
/supabase/tests           pgTAP tests (RLS, functions)
/supabase/seed            seed data (roles, permissions, activity profiles)
/fixtures                 HTML pages, CSV samples, SERP JSON
/docs/adr                 architecture decision records
/docs/runbooks            operations runbooks
```

### 0.5 Architecture decisions already taken (recommended defaults)

| # | Decision | Alternative rejected | Cost of this choice | Reversibility |
|---|---|---|---|---|
| A1 | Modular monolith: one Python worker process type with pluggable stages, one Next.js app, one Postgres | Microservices, separate queue service (spec forbids extra queue) | Stages share a deploy unit | Easy |
| A2 | Postgres as queue using `FOR UPDATE SKIP LOCKED` and leases | Redis, Celery | Polling load on DB; fine at this scale | Medium |
| A3 | Worker talks to Postgres directly with `psycopg` (async pool), not through PostgREST | supabase-py for claims | Needs a DB connection string and pooler setup | Medium |
| A4 | Permissions are a catalog table seeded by migration. Roles pick from the catalog. RLS calls `has_permission(key)`. UI checks are convenience only | Hard-coded roles | Adding a new permission needs a migration | Easy |
| A5 | Job edits create a new `config_version`. Workers read the snapshot for that version. Stored results are never rewritten | Mutating config in place | Extra history table | Hard to retrofit, so do it now |
| A6 | Pipeline per opportunity is a state machine: discovered, normalized, check-pending, checked, scored, queue-assigned | One big function | More states to test | Medium |
| A7 | Fetcher has SSRF guards, size caps and a per-domain rate limiter | Trust input URLs | More code | Hard to retrofit, so do it now |
| A8 | CSV parsing runs in the worker, not in a web request | Parse in Next.js route | Slight upload-to-summary delay | Easy |
| A9 | Dashboard polls counters every few seconds | Supabase Realtime | Less instant | Easy |
| A10 | Search provider behind an interface (`SearchProvider`) | Direct Serper calls | One extra layer | Easy |

Confidence: A1, A2 strong opinion. A3 context-dependent. A5, A7 established.

### 0.6 Global business invariants (must hold in every MVP)

- **I1 Cost:** Serper is the only paid service. No paid LLM, crawler, proxy or SEO API.
- **I2 Bot discovers and ranks. People decide.** The bot never marks anything Approved or Rejected.
- **I3 Nothing is silently deleted.** Failed, unchecked and auto-filtered results are stored with a reason.
- **I4 "Could not check" is not "fail."** Unchecked results stay in the list, ranked lower.
- **I5 Budget is counted in credits actually consumed**, as reported by Serper per call.
- **I6 Competitor gap runs first**, then Google footprint search.
- **I7 Duplicates:** unique on (job, normalized URL). Repeat discovery adds a "found by" record and bumps the duplicates counter. The same URL can exist in different jobs.
- **I8 Job edits apply to future queries and checks only.** They never rewrite stored results.
- **I9 Score is for ordering, not a quality verdict.** Weights are configuration.
- **I10 Top 3 reasons** are shown on each ranked row.
- **I11 Polite fetching:** identifies itself, respects robots.txt, rate-limits per domain, plain HTTP only (no headless browser).
- **I12 Service key never reaches the browser.** Roles are enforced by RLS.
- **I13 Admin cannot be locked out:** the Admin role cannot be deleted or stripped of role-management permission.
- **I14 Reject reason is required when rejecting.** Spam rejects are global. Off-topic rejects are niche-scoped.
- **I15 Success metric** is approval rate of the top 50 results, not rows stored.

---

## 1. MVP map and traceability

| MVP | Name | Spec sections covered |
|---|---|---|
| M0 | Foundation and project setup | 2, 12 |
| M1 | Identity, roles and permissions | 4, 11 (users, roles) |
| M2 | Jobs, job form and activity profiles | 3, 5, 8 (statuses), 13 |
| M3 | Pipeline backbone: URL rules, storage, worker engine | 7, 8, 9, 11 |
| M4 | Competitor gap (CSV) | 6.2 |
| M5 | Free checks, scoring, tiers, queue groups | 6.3, 6.4, 6.5 (groups), 6.6 |
| M6 | Review workflow, export | 6.5, 9, 10 (capture, reject scope) |
| M7 | Feedback reporting and blocklist | 10 (v1 reporting) |
| M8 | Footprint search via Serper, budget, saturation | 6.1, 8 |
| M9 | Hardening, deployment, UAT | 2 (hosting), all |
| M10 | Phase 2 backlog (not built now) | 14 Phase 2 and Later |

Build order follows spec Section 14: roles, then competitor gap, then checks and review, then Serper search. Parallel work is possible where `Needs` allows.

---

## 2. Spec gaps found (need product confirmation, defaults given)

| ID | Gap | Default used until confirmed |
|---|---|---|
| G1 | "Stop ends the job" but no "Stopped" status exists in the list. | Add terminal status `Stopped`. |
| G2 | "Failed" is never defined. | Job becomes Failed only on unrecoverable config or system error, or when every query row fails. A few failed rows never fail the job. |
| G3 | "Saturated" says auto-pause. Is it resumable? | Yes. Resume asks for confirmation. Saturation is re-evaluated after N more completed queries. |
| G4 | When a job is Saturated, budget-reached or Stopped, do pending checks finish? | Stop and saturation stop claiming new **queries**. Pending **checks** drain so found results get scored. Stop (explicit) halts everything, including checks. |
| G5 | How does the "Ready for review" top 50 behave over time? | Ready holds at most N undecided rows. New higher-scored rows never evict rows already shown. A "Release next batch" action pulls the best rows from Backlog. |
| G6 | Job form has "reference sites", "own seed lists", "competitor domains". Their use is not defined. | Seed list URLs are imported as opportunities (`source=seed_list`). Competitor domains label CSV uploads and are excluded from results. Reference sites are stored and excluded from results; no other use in v1. |
| G7 | "Local business data" has no use in v1 activities. | Stored on the job only. Not used by any v1 query template. |
| G8 | Off-topic reject is niche-scoped. What is the niche key? | Normalized (business_type, sub_niche). Product maintains a controlled list over time. |
| G9 | Difference between "spam-rejected flag" and "global blocklist". | Flag = warning, with a per-job option to skip. Blocklist = hard auto-filter, never fetched. One-click promote from flag to blocklist. |
| G10 | Overlap boost counts what? | Distinct competitor labels linking to the domain, not raw rows. |
| G11 | "New unique domain" for saturation. | A registered domain not yet seen in this job from any source. |
| G12 | What makes a result "Unchecked"? | Any essential check (page load, language, relevance) returns could-not-check, or the domain check cap was hit. |
| G13 | Reviewer assignment is not in the spec. Status "In review" exists. | "In review" is a soft claim by one reviewer with a visible name. No hard assignment. |
| G14 | Domain cache lifetime and which URLs get checked under the per-domain cap. | TTL 7 days. First N URLs by priority: overlap count desc, then multi-query count desc, then discovery order. |
| G15 | Who can add to blocklist and who can mark "Used". | Permission-based: `blocklist.manage` and `results.review`. Starter role mapping in M1. |
| G16 | Exact definition of the success metric. | Top-50 approval rate = (Approved + Used) / (Approved + Used + Rejected) among rows that were in the job's **first** Ready batch and have a decision. |
| G17 | Backlog release batch size. | 25 rows. |
| G18 | If the client CSV exists, Google results from domains already linking to the client. | Flag `already_links_to_client`. Not removed. (Architect addition, small.) |
| G19 | Data retention and storage size on free tier. | Never store page bodies. Store title, meta, headings snippet and extracted signals only. Review size in M9. |
| G20 | Reject reasons list: "other" needs a note? | Note required when reason = other. |

---

# MVP 0: Foundation and project setup

**Goal:** an empty but fully wired project. Anyone can clone it, run it locally, and CI is green.
**Needs:** nothing.

## Build tasks

**M0-S1 Repository and tooling**
Build: monorepo with the layout in 0.4. Add `README`, `CONTRIBUTING`, `.editorconfig`, `.gitignore`, pre-commit hooks (ruff, prettier, eslint, gitleaks), conventional commits, PR template with Definition of Done checklist, `docs/adr/0000-template.md`.
Done when: a fresh clone passes `make setup && make check`.

**M0-S2 Supabase local project**
Build: Supabase CLI config, `supabase start` working, migrations folder, empty seed, scripts for type generation (`supabase gen types typescript`), a `make db-reset` target, a first migration enabling extensions (`pgcrypto`, `pg_trgm`).
Done when: `make db-reset` applies all migrations to a clean DB with no errors.

**M0-S3 Web app scaffold**
Build: Next.js (App Router, TypeScript strict), Tailwind, shadcn/ui, `@supabase/ssr` client helpers (browser, server, middleware), env validation with zod (fail fast), base layout with navbar (Jobs, Reports, Admin placeholders), `/api/health` route.
Done when: app builds, health route returns 200, lint and type-check pass.

**M0-S4 Worker scaffold**
Build: Python 3.12 project (`uv` or Poetry), packages `config`, `db`, `engine`, `stages`, `fetch`, `checks`, `scoring`, `providers`, `io`. Pydantic settings, `structlog` JSON logging with `job_id`, `task_id`, `worker_id` fields, SIGTERM-safe main loop, DB connection pool, heartbeat stub.
Done when: `python -m worker` starts, connects to the DB, logs a heartbeat, and exits cleanly on SIGTERM.

**M0-S5 Dependencies (all free and open source)**
Web: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `react-hook-form`, `@tanstack/react-query`, `@tanstack/react-table`, `papaparse` (preview only), `recharts`, `date-fns`, `vitest`, `playwright`.
Worker: `httpx[http2,brotli]`, `selectolax` (or `beautifulsoup4` + `lxml`), `tldextract` (offline snapshot), `protego` (robots), a language detector (see M5-D1), `psycopg[binary,pool]`, `pydantic`, `pydantic-settings`, `structlog`, `tenacity`, `charset-normalizer`, `snowballstemmer`, `pytest`, `pytest-asyncio`, `respx`, `hypothesis`, `testcontainers`, `ruff`, `mypy`, `pip-audit`.
Done when: lockfiles committed, install is reproducible, no paid or API-key-gated package is present.

**M0-S6 CI pipeline (GitHub Actions free tier)**
Build: jobs for lint, type-check, unit tests, migrations on clean DB, pgTAP tests, web build, worker Docker build, dependency audit, secret scan.
Done when: pipeline runs on every PR and blocks merge on failure.

**M0-S7 Containerization and local run**
Build: worker `Dockerfile` (non-root, slim), `docker-compose.yml` for local worker, `.env.example` for web and worker, `docs/secrets.md` listing every variable and who may hold it.
Done when: `docker compose up` starts the worker against local Supabase.

**M0-S8 Test harness**
Build: pytest markers (`unit`, `integration`), DB fixtures using testcontainers or local Supabase, `fixtures/` folder conventions, pgTAP runner, Playwright skeleton with login helper.
Done when: one sample test per layer runs in CI.

**M0-S9 ADR set**
Build: write ADRs for A1 to A10 from Section 0.5 using the template.
Done when: ADRs merged and indexed in `docs/adr/README.md`.

## Human-owned: decisions and manual work

**Developer decisions**
- **M0-D1** Python package manager (default `uv`).
- **M0-D2** Always-on host for the worker that fits the free rule. Free hosts often sleep. Options to check: an existing server or VPS, an always-free cloud VM, a free container tier that does not sleep. **Blocks M9, but pick early.**
- **M0-D3** Error tracking: default structured logs plus `job_events` only (no third-party). A free-tier tool is allowed only if product confirms (see M0-P1).
- **M0-D4** UI kit: default shadcn/ui.

**Developer manual work**
- **M0-DM1** Create the Supabase project (cloud). Check the plan limits: DB size (free tier is small), pause-on-inactivity, connection limits, no point-in-time recovery. Report limits to product (see M9-S3).
- **M0-DM2** Create the Git repo, set CI secrets, branch protection.
- **M0-DM3** Create separate staging and production projects if the free plan allows two.
- **M0-DM4** Configure the Supabase pooler and get the direct Postgres connection string for the worker.

**Product team decisions**
- **M0-P1** Confirm that free tiers of third-party tools (error tracking, hosting) are acceptable under the cost rule, or that none are allowed. Spec Section 2 says flag any paid plan before building.
- **M0-P2** Confirm the product name and the bot's public name.

**Product team manual work**
- **M0-PM1** Name the initial admin person (email) for M1 bootstrap.

**Exit criteria:** clean clone runs web, DB and worker locally. CI green. ADRs written.

---

# MVP 1: Identity, roles and permissions

**Goal:** login, invite-only users, fully dynamic roles with the role builder screen, enforced by RLS.
**Needs:** M0.

## Build tasks

**M1-S1 Schema**
Build migration for: `profiles` (id references `auth.users`, email, full_name, role_id, is_active, created_at), `roles` (id, name unique, description, is_system, is_protected), `permissions` (key primary key, group, description), `role_permissions` (role_id, permission_key).
Done when: tables exist with FKs and indexes. `role_id` required on `profiles`.

**M1-S2 Permission catalog and seed**
Build seed with these keys (extend only via migration):

| Group | Keys |
|---|---|
| Jobs | `jobs.view`, `jobs.create`, `jobs.edit`, `jobs.delete`, `jobs.start`, `jobs.control` (pause, resume, stop), `jobs.rescore` |
| Results | `results.view`, `results.view_filtered`, `results.review`, `results.export`, `results.release_batch` |
| Data | `csv.upload`, `mapping_templates.manage`, `blocklist.manage`, `activities.manage`, `reports.view` |
| Admin | `users.manage`, `roles.manage`, `system.view_health` |

Seed three roles (`is_system=true`):
- **Admin**: all permissions. Protected.
- **Manager**: `jobs.view`, `results.view`, `results.view_filtered`, `results.review`, `results.export`, `results.release_batch`, `csv.upload`, `mapping_templates.manage`, `blocklist.manage`, `reports.view`. Note: This replaces the earlier "Product team" terminology.
- **Viewer**: `jobs.view`, `results.view`, `reports.view`.
Done when: seed is idempotent and a test asserts the mapping.

**M1-S3 SQL authorization helpers and RLS**
Build: `has_permission(text)` (security definer, stable, uses `auth.uid()` and `is_active`), `current_role_id()`. RLS on all tables. Reads of `roles`, `permissions`, `role_permissions` for any authenticated user. Writes only with `roles.manage`. Profiles writes only with `users.manage`.
Done when: a pgTAP matrix proves each starter role against each table and operation.

**M1-S4 Lockout protection (triggers)**
Build: block delete or edit-to-remove of `roles.manage` and `users.manage` on the Admin role. Block deleting `is_protected` roles. Block deleting a role that still has users (require reassign). Block deactivating, deleting or demoting the **last active Admin user**.
Done when: tests attempt each forbidden action as Admin and fail with clear error codes.

**M1-S5 Authentication**
Build: email and password login with Supabase Auth, logout, password reset, session refresh in middleware, no public sign-up. Optional MFA (TOTP) switch.
Done when: unauthenticated users are redirected to login on every dashboard route.

**M1-S6 User management screen (`users.manage`)**
Build: list users, create or invite user, assign role, deactivate and reactivate, force password reset. Admin-created users use a server-only action with the service key (never in client bundles).
Done when: a user created here can log in with the assigned role. Deactivated users are rejected by RLS immediately.

**M1-S7 Role builder screen (`roles.manage`)**
Build: role list with user counts and badges (system, protected). Create, edit, clone, delete. Permission matrix grouped by catalog group, with search and select-all per group. Surface DB lockout errors in plain language.
Done when: an Admin builds a custom role, assigns it, and that user sees only allowed nav items and can perform only allowed actions.

**M1-S8 Authorization in the UI**
Build: server helper `getPermissions()`, `<Can permission="...">` component, route guards, nav filtering. Document that RLS is the real gate.
Done when: hitting a guarded URL without permission shows a 403 page, and direct API calls without permission fail at the DB.

**M1-S9 Bootstrap script**
Build: one-time script creating the first Admin from env vars.
Done when: running it twice is safe (idempotent).

**M1-S10 Tests**
Build: pgTAP RLS matrix, lockout tests, Playwright: login, build role, assign role, verify visibility.

## Human-owned: decisions and manual work

**Developer decisions**
- **M1-D1** How Admin creates users: default is admin sets a temporary password or copies a one-time link (no email needed). Supabase default SMTP is rate-limited. Alternative: custom SMTP (free tier of a mail provider).
- **M1-D2** Where the service key lives for user creation: default is a Next.js server action reading a server-only env var, reachable only after a `users.manage` check. Alternative: a Supabase Edge Function.
- **M1-D3** MFA: default optional, off.

**Developer manual work**
- **M1-DM1** Run the bootstrap script in each environment with the real Admin email.
- **M1-DM2** Configure auth redirect URLs and (if used) SMTP.

**Product team decisions**
- **M1-P1** Approve the permission catalog and starter role mapping above.
- **M1-P2** Can Manager role add to the global blocklist? (G15)
- **M1-P3** Password and session policy; email domain restriction for invites.

**Product team manual work**
- **M1-PM1** List the real users and roles to create at launch.

**Exit criteria:** Admin can log in, build roles, create users. RLS matrix passes. Lockout tests pass.

---

# MVP 2: Jobs, job form and activity profiles

**Goal:** admins create, edit and manage Search Backlinks jobs with every field in the spec. Activity profiles are configurable. Lifecycle state machine exists (no worker yet).
**Needs:** M1.

## Build tasks

**M2-S1 Schema**
Build migrations:
- `activity_profiles`: id, key (unique), name, enabled, `footprint_templates` jsonb, `page_type_signals` jsonb, `relevance_rule` jsonb, `scoring_weights` jsonb, `per_domain_cap` int, `reviewer_fields` jsonb, version.
- `jobs`: id, `job_type` (default `search_backlinks`, check constraint), name, client, client_domain, target_urls[], business_type, sub_niche, activity keys[], country, language, regions[], seed_keywords[], brand_variants[], competitor_domains[], reference_sites[], seed_list_urls[], banned_categories[], blocked_domains[], require_language_region_match, budget_credits, pages_per_query, saturation_n (default 20), saturation_x (default 3), per_domain_cap (default 10), review_queue_size (default 50), skip_previously_spam_domains bool, scrape_credit_cap (default 0, unused until Phase 2), local_business jsonb, status, config_version, created_by, timestamps.
- `job_config_history`: job_id, version, snapshot jsonb, changed_by, changed_at.
- `job_events`: job_id, type, payload jsonb, actor, created_at.
- `blocklist`: domain unique, reason, added_by, source_job_id, created_at.
Done when: migrations apply and RLS follows the permission keys.

**M2-S2 Job form**
Build: sectioned form following spec Section 5: Basics, Activities, Targeting, Discovery sources, Filters, Limits, Local business (shown only when toggled on). Chip inputs for lists. Validation: domain and URL format, country (ISO 3166), language (ISO 639-1), at least one enabled activity, integers and ranges. Save as Draft at any time.
Done when: every field in the spec is saved and reloaded exactly.

**M2-S3 Edit semantics (A5)**
Build: every save of a non-Draft job writes a new `config_version` and a `job_config_history` row. Banner on edit: "Edits apply to future queries and checks only." Workers and later tasks read config by version, and results record the version used.
Done when: editing keywords on a Running job (once workers exist) never changes stored rows. A test proves history and versions.

**M2-S4 Jobs section and list**
Build: **Jobs** navbar entry. List with name, client, status, activities, counters (zeros until M3), created by, filters, search, sort, pagination.
Done when: list respects `jobs.view`.

**M2-S5 Job detail shell**
Build: tabs Overview, Config, Uploads (M4), Results (M6), Queries (M8), Report (M7), Activity log. Tabs with no data yet show empty states.
Done when: tabs exist and permission-gate correctly.

**M2-S6 Lifecycle state machine**
Build: SQL function `transition_job(job_id, action)` enforcing allowed transitions and permissions. Statuses: Draft, Queued, Running, Paused, Completed, Failed, Saturated, plus `Stopped` (G1).

| From | Action | To | Who |
|---|---|---|---|
| Draft | start | Queued | `jobs.start` |
| Queued | worker picks up | Running | worker |
| Running | pause | Paused | `jobs.control` |
| Paused | resume | Running | `jobs.control` |
| Running or Paused or Saturated | stop | Stopped | `jobs.control` |
| Running | auto | Saturated, Completed, Failed | worker |
| Saturated | resume | Running | `jobs.control` (G3) |

Start validations: required fields present, at least one enabled activity, a source exists (CSV uploaded or search enabled with budget above 0).
Done when: illegal transitions are rejected in SQL, every transition writes a `job_events` row.

**M2-S7 Job actions UI**
Build: Start, Pause, Resume, Stop buttons with confirmation and permission checks. Delete job (`jobs.delete`) with typed-name confirmation.
Done when: buttons show only when valid for the current status.

**M2-S8 Activity profiles admin (`activities.manage`)**
Build: list, create, edit, enable and disable. Structured editors (not raw JSON) for footprint templates (placeholders `{keyword}`, `{niche}`, `{brand}`, `{country}`, `{city}`), page-type signals (URL patterns, title and heading phrases, structure hints), relevance rule, scoring weights, per-domain cap, reviewer fields. JSON-schema validation. Version bump on every save. Seed `guest_post` and `resource_page` profiles with starter content from M2-PM1.
Done when: a new activity can be added and appears in the job form without code changes (spec Section 13).

**M2-S9 Global blocklist admin (`blocklist.manage`)**
Build: list, add, remove, bulk paste or CSV import, reason, filter. Domain normalized through the M3 domain function once available (use a placeholder normalizer until then).
Done when: blocklist entries are unique by registered domain.

**M2-S10 Activity log tab**
Build: show `job_events` for the job (who, when, what, config version).

**M2-S11 Tests**
Build: form validation unit tests, state machine tests (every cell of the transition table), RLS tests, Playwright: create job, edit, start-blocked-without-source.

## Human-owned: decisions and manual work

**Developer decisions**
- **M2-D1** List fields as arrays and jsonb (default) versus join tables. Default keeps the form simple. Revisit only if reporting needs it.
- **M2-D2** Job "clone" feature: not in spec. Default: skip.

**Developer manual work**
- None beyond migrations review.

**Product team decisions**
- **M2-P1** Confirm G1 (Stopped), G2 (Failed), G3 (Saturated resumable), G6 (reference sites, seed lists, competitor domains), G7 (local business data).
- **M2-P2** Controlled lists for business type, sub-niche, supported countries and languages (free text versus pick lists). Needed for G8.
- **M2-P3** Default values for budget, pages per query, queue size, saturation N and X, per-domain cap. Spec gives 50, 20, 3, 10.
- **M2-P4** Activity-specific per-domain caps (spec suggests 1 to 3 for guest post and resource page).

**Product team manual work**
- **M2-PM1** Provide starter content for the two activity profiles: footprint templates per language, page-type signals (for example "write for us", "submit a guest post", "useful links", "resources"), relevance rule, reviewer fields (for example DR, traffic, contact email), and cap. The dev team can seed placeholders, but real quality depends on this.
- **M2-PM2** Provide the banned categories vocabulary and the initial global blocklist.

**Exit criteria:** an Admin can create and edit a full job, manage activity profiles and the blocklist, and move a job through Draft to Queued. State machine fully tested.

---

# MVP 3: Pipeline backbone (URL rules, storage, worker engine)

**Goal:** the shared core every source uses: URL normalization, deduplication, opportunity storage, domain cache, job engine with leases, pause and stop, counters. Still no checks or search.
**Needs:** M0, M2.

## Build tasks

**M3-S1 URL normalization library (pure functions)**
Build `normalize_url(raw) -> {original, normalized, host, registered_domain, error}` in the worker, and a TypeScript twin or a shared test vector file so the dashboard (blocklist, search) matches. Rules from spec Section 7:
- lowercase host, strip leading `www.`
- unify `http` and `https` to one scheme (store `https`)
- remove fragments
- remove tracking parameters (`utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_cid`, `mc_eid`, `yclid`, `igshid`, and a configurable list)
- remove trailing slash (except root)
- drop default ports, convert IDN to punycode, normalize percent-encoding
- reject non-http(s), empty and malformed input
- keep the original URL
Done when: at least 100 test vectors pass, plus property tests (idempotent: normalizing twice gives the same result).

**M3-S2 Registered-domain extraction**
Build: `tldextract` using the bundled snapshot only (no network calls at runtime). Include private suffixes so `a.blogspot.com` and `b.blogspot.com` are different domains. Return registered domain as the domain-level key.
Done when: tests cover `co.uk`, `com.au`, `blogspot.com`, IP hosts, and localhost (rejected).

**M3-S3 Core schema**
Build migrations:
- `opportunities`: id, job_id, original_url, normalized_url, domain, **unique (job_id, normalized_url)**, source summary, `activity_key`, `check_status` (pending, running, done, failed, skipped), `check_reason`, lease fields (`locked_by`, `lease_expires_at`, `attempts`), `queue_group` (auto_filtered, ready, backlog), `score`, `tier`, `score_breakdown` jsonb, `config_version`, `overlap_count`, `client_link_status`, flags jsonb, extras jsonb, fetch summary, review fields (placeholders until M6), timestamps.
- `opportunity_sources`: opportunity_id, source_type (google, competitor_csv, seed_list), source_ref (query id, upload id, label), found_at. Unique (opportunity_id, source_type, source_ref).
- `domains`: registered_domain unique, robots text and fetched_at, `blocked_suspected` flag, TLD flags, contact/about detection, last fetch status, global spam flag fields, cache timestamps.
- `job_stats`: job_id, credits_used, queries_total, queries_done, unique_opportunities, duplicates_skipped, unchecked_count, updated_at.
- `worker_heartbeats`: worker_id, host, started_at, last_seen_at, current_job_id.
Indexes: claim index on (`check_status`, `lease_expires_at`), (`job_id`, `queue_group`, `score` desc), (`job_id`, `domain`).
Done when: schema applies, RLS enforces permission keys, `EXPLAIN` on claim and ranking queries uses indexes.

**M3-S4 Discovery recorder**
Build SQL function `record_discovery(job_id, raw_url, source_type, source_ref, extras)`:
1. normalize, 2. check job blocklist and global blocklist (store, but mark auto-filtered `blocklisted`, no fetch), 3. insert or, on conflict, add an `opportunity_sources` row and increment `duplicates_skipped`, 4. return whether it is new.
Add **post-fetch merge**: if the final URL (after redirects or canonical) normalizes to an existing opportunity, merge sources into it, mark the later row `duplicate_of`, and do not double count.
Done when: concurrent inserts of the same URL from two workers produce one row and correct counters.

**M3-S5 Previously-rejected flags at discovery**
Build: on discovery, flag domains with a global spam flag (G9). If `skip_previously_spam_domains` is on, mark auto-filtered `previously_spam`. Off-topic niche flags (G8) are informational flags only.
Done when: flags appear on rows and skip works. (Review actions that set the flags arrive in M6-S5.)

**M3-S6 Job engine: claim, lease, reap (A2, A3)**
Build:
- SQL `claim_opportunity_checks(worker_id, batch, lease_seconds)` using `FOR UPDATE SKIP LOCKED`, joined to `jobs.status = 'running'` only.
- Lease extension while processing. Reaper returns rows whose lease expired to `pending` and increments `attempts`. After `max_attempts` (default 3) mark `failed` with reason.
- Python worker loop with configurable concurrency, graceful shutdown that releases claims.
- Priority: gap-source rows before search rows (I6).
Done when: killing a worker mid-batch (`kill -9`) returns its rows after lease expiry, and two workers never process the same row.

**M3-S7 Job runner (orchestrator)**
Build: picks up Queued jobs (to Running), runs phases in order: (1) seed-list and gap import (M4), (2) query generation and search (M8), draining checks throughout. Detects completion when no pending work remains. Handles G2 (Failed) and G4 (drain behavior). Stop halts claims immediately.
Done when: a job with no sources completes cleanly, and Pause stops new claims within one polling interval.

**M3-S8 Live counters**
Build: update `job_stats` in the same transaction as the event that changes it. Unchecked count includes G12 cases. Dashboard Overview tab shows credits used vs budget, queries done vs total, unique opportunities, duplicates skipped, unchecked, polled every few seconds (A9).
Done when: counters equal a recomputation from raw tables in a consistency test.

**M3-S9 Worker health**
Build: heartbeat every 15 seconds, stale detection, "worker online" indicator in the dashboard header for admins.

**M3-S10 Tests**
Build: concurrency tests (2 to 4 workers), crash and lease tests, pause and stop tests, dedup race test, normalization vectors.

## Human-owned: decisions and manual work

**Developer decisions**
- **M3-D1** Tracking parameter list and whether to sort remaining query parameters (default: sort, for stable dedup).
- **M3-D2** Counter strategy: transactional `job_stats` (default) versus views.
- **M3-D3** Polling interval, claim batch size, lease length, max attempts (defaults: 5 s, 10, 120 s, 3).
- **M3-D4** Whether redirects to a different registered domain count as a different domain for caps (default: yes, final domain).

**Developer manual work**
- **M3-DM1** Deploy the worker once to the chosen host (M0-D2) and confirm it reaches the DB and stays up.

**Product team decisions**
- **M3-P1** Confirm G2, G4, G10, G11, G12, G14.

**Product team manual work**
- None.

**Exit criteria:** workers claim, lease and recover work safely. Pause and stop work. Dedup and counters correct under concurrency.

---

# MVP 4: Competitor gap (CSV)

**Goal:** upload competitor and client CSVs, map columns, validate, compute the domain-level gap with overlap, and create opportunities. This is the first real source.
**Needs:** M1, M2, M3.

## Build tasks

**M4-S1 Schema**
Build: `csv_uploads` (id, job_id, kind `competitor|client`, competitor_label, filename, storage_path, status, counts: total, valid, invalid, empty, duplicate; mapping jsonb, template_id, error_report_path, uploaded_by), `csv_rows` staging (upload_id, row_no, raw_url, normalized_url, domain, extras jsonb, is_valid, error_code), `mapping_templates` (name, kind, mapping jsonb, created_by, shared).
Done when: RLS requires `csv.upload` for writes.

**M4-S2 Upload UI and storage**
Build: drag-and-drop on the job's Uploads tab. Upload to a private Supabase Storage bucket with policies tied to `csv.upload`. Choose type (competitor or client). Competitor uploads require a **competitor label** (domain). Size limit configurable. Multiple competitor files allowed.
Done when: files land in the bucket and a `csv_uploads` row exists in status `uploaded`.

**M4-S3 File reading**
Build in worker: detect encoding (UTF-8 with BOM, UTF-16, others via `charset-normalizer`), detect delimiter (comma, tab, semicolon), stream rows with bounded memory, handle quoted fields and embedded newlines.
Done when: tests pass on sample exports in the styles of Ahrefs, Semrush and GSC (see M4-PM1) and on a synthetic 500,000-row file without memory growth.

**M4-S4 Mapping screen**
Build: preview first 20 rows, choose the **URL** column (required), auto-guess from header names, label other columns (name and type: text, number, date, ignore). Save as mapping template, apply a template (auto-suggest when headers match).
Done when: only the URL column is mandatory and other columns land in `extras`.

**M4-S5 Validation and import summary**
Build: worker validates each row (empty, bad URL, non-http(s)), normalizes, stages. Summary page: total, valid, invalid by reason, empty, duplicates inside the file, sample errors, downloadable error CSV. Team confirms or discards. Re-upload replaces the previous file of the same label.
Done when: counts add up exactly (total = valid + invalid + empty).

**M4-S6 Gap calculation (domain level)**
Build: at job start, compute: domains in competitor files, minus domains in client files, minus the client's own domain, minus competitor and reference domains themselves (G6). `overlap_count` = distinct competitor labels (G10). If no client file: set `client_link_status = unknown` on all results. If a client file exists: `known_partial` (GSC exports are partial, so some gaps may be false). Recompute is idempotent.
Done when: unit tests cover overlap counts, subdomains, no client file, and own-domain exclusion.

**M4-S7 Create opportunities from gap and seed lists**
Build: for each gap domain, record every linking URL from competitor files through `record_discovery` with `source_type=competitor_csv` and `source_ref=label`. Store `overlap_count` and extras. Import job seed-list URLs with `source_type=seed_list` (G6). Gap rows enter check queue first (I6).
Done when: re-running creates no duplicates and bumps the duplicates counter correctly.

**M4-S8 Uploads tab UX**
Build: per-file status and summary, pre-start gap preview (domains in gap, overlap distribution, warning when no client file), delete or replace file.

**M4-S9 Tests**
Build: fixtures for three export styles, malformed files, huge file test, gap property tests, RLS tests, Playwright: upload, map, confirm, start job.

## Human-owned: decisions and manual work

**Developer decisions**
- **M4-D1** Max upload size and row limit (default 100 MB, 2 million rows).
- **M4-D2** Treat subdomain links as the registered domain (default yes, domain-level gap per spec).

**Developer manual work**
- **M4-DM1** Create the private Storage bucket and policies in each environment. Confirm Storage free-tier size.

**Product team decisions**
- **M4-P1** Confirm G6 and G10. Confirm the gap is domain-level but all linking pages are kept as opportunities.
- **M4-P2** Extra columns to keep and show (for example nofollow flag, anchor text, page traffic).
- **M4-P3** Exclusion lists beyond the blocklist (large social sites and similar). Default: use the blocklist.

**Product team manual work**
- **M4-PM1** **Provide real sample exports** from Ahrefs, Semrush and GSC (Links report), small and large. Needed before M4-S3 can be trusted.
- **M4-PM2** Prepare competitor and client exports for the pilot job. Name each competitor file's label.

**Exit criteria:** a job with competitor and client CSVs produces correct gap opportunities with overlap counts and correct import summaries.

---

# MVP 5: Free checks, scoring, tiers and queue groups

**Goal:** every opportunity gets checked with free HTTP checks, scored, tiered and sorted into Auto-filtered, Ready and Backlog.
**Needs:** M3, M4 (for real data), M2 (activity profiles).

## Build tasks

**M5-S1 Polite fetcher (A7)**
Build async `httpx` fetcher:
- identifying User-Agent with a contact URL (M5-P1)
- timeouts (connect 5 s, total 15 s), max 5 redirects, max body 2 MB (stream and cut), accept HTML only, retry 5xx and timeouts up to 2 times with backoff
- per-domain rate limiter (default one request per 2 s) and global concurrency limit
- **SSRF guard:** resolve DNS, block private, loopback, link-local and cloud-metadata ranges, re-check on every redirect, ports 80 and 443 only
- record redirect chain and final URL
- classify outcome: `ok`, `http_4xx`, `http_5xx`, `timeout`, `dns_fail`, `tls_error`, `blocked_suspected` (403, 429, 503 with challenge markers such as Cloudflare), `js_only_suspected` (tiny body, empty app shell), `non_html`, `too_large`
Done when: tests with `respx` cover each outcome, and SSRF tests prove private IPs and redirect-to-private are refused.

**M5-S2 Robots handling and domain cache**
Build: fetch and cache `robots.txt` per domain (TTL 7 days, G14) in `domains`. If robots disallows our user agent for a URL, **do not fetch** and return could-not-check with `robots_disallowed_for_bot`. Cache domain-level facts (TLD flags, contact and about detection, blocked-suspected). If a domain is `blocked_suspected`, short-circuit other pages from that domain to unchecked to avoid hammering.
Done when: one domain with many URLs triggers one robots fetch per TTL.

**M5-S3 Check framework and reason codes**
Build: `Check` interface returning `status` (pass, fail, could_not_check), `reason_code`, `detail`, `evidence` jsonb. Registry, ordered execution with short-circuit (dead page ends the run). Store in `opportunity_checks` (opportunity_id, check_key, status, reason_code, evidence, config_version, checked_at). Reason-code catalog with human-readable templates for the "top 3 reasons".
Done when: adding a check needs one class and one catalog entry.

**M5-S4 Checks (each with fixtures and tests)**
1. `page_loads`: fail for 404, 410, persistent 5xx, DNS failure. Could-not-check for timeouts after retries, blocked-suspected, JS-only, TLS issues (confirm in M5-P4).
2. `indexable`: fail when `meta robots noindex`, `X-Robots-Tag: noindex`, or robots.txt disallows Googlebot for the URL. Note canonical pointing to another URL (feeds the post-fetch merge in M3-S4).
3. `language`: read `<html lang>` and `Content-Language`, then detect from visible text with the free library. Minimum text length, else could-not-check. Compare to job language with a confidence threshold.
4. `region` (when the job filter is on): ccTLD, hreflang, html lang region, content signals.
5. `relevance`: tokenize title, meta description, headings, body. Match job seed keywords, niche terms and brand variants. Weight fields (title and headings above body), light stemming, output 0 to 1 plus matched terms.
6. `spam_signals` (rule-based): outbound link count and ratio, thin content, spam keyword lists (casino, pharma and so on), no contact or about page, suspicious TLD list. Each signal has its own reason code.
7. `activity_fit`: per activity in scope, use the profile's page-type signals (URL patterns, title and heading phrases, link-list structure for resource pages). Assign `activity_key` to the best match.
8. `banned_category`: keyword and category lists from the job. Fail means auto-filter.
Done when: a fixture library (see M5-S10) gives expected results for each check.

**M5-S5 Per-domain check cap**
Build: only N URLs per domain per job get full checks (job default 10, activity override). The rest are stored with `check_status=skipped`, reason `domain_cap`, tier Unchecked, and stay in Backlog. Choice order follows G14. Counter update is atomic under concurrency.
Done when: a concurrency test with 50 URLs from one domain runs exactly N checks.

**M5-S6 Auto-filter rules**
Build: clear failures go to `auto_filtered` with a visible reason: dead page, blocked from indexing, wrong language (high confidence only), banned category, blocklisted, previously-spam when skipping. Everything else continues. **Nothing is deleted.**
Done when: each rule has a test and a reason shown in the data.

**M5-S7 Scoring engine**
Build: pure function `score(opportunity, checks, source_signals, config) -> {score 0..100, tier, breakdown}`.
- Components: relevance (highest weight), language and region match, activity fit, spam (negative), competitor overlap (boost, diminishing), multi-query appearance (boost).
- Weights from the activity profile with global defaults. Tier thresholds are config (High, Medium, Low). Tier is **Unchecked** under G12.
- Breakdown stored as list of `{component, raw, weight, points, reason_code}` with config version. Top 3 reasons generated from the catalog (I10).
- Same scoring for gap and search rows.
- Admin action **Rescore** (`jobs.rescore`) re-applies current weights to stored checks, with confirmation. Never automatic.
Done when: golden-file tests prove deterministic results, and rescoring changes only score fields.

**M5-S8 Queue-group assignment**
Build: after scoring, assign `ready`, `backlog` or `auto_filtered`. Ready holds the top N undecided rows by score (job `review_queue_size`, default 50) with ties broken by overlap then discovery time. Backlog holds the rest of passed rows including Unchecked (ranked lower). Implement G5 and a `release_backlog(job_id, n)` function (default n = 25, G17) gated by `results.release_batch`. Record `first_ready` membership and rank at first assignment (needed for the success metric, G16).
Done when: new higher-scored rows do not evict shown rows, and release picks the best backlog rows.

**M5-S9 Pipeline wiring**
Build: worker stage: claim check task, fetch, run checks, score, assign group, update counters, release lease. Failures set `check_status=failed` with a reason and never block others.
Done when: an end-to-end test runs a gap job over fixtures to a ranked result set.

**M5-S10 Fixture library and calibration harness**
Build: at least 40 saved HTML pages: good guest post page, good resource page, casino spam, pharma spam, thin content, noindex, wrong language, redirect chain, Cloudflare challenge, JS-only shell, huge page, non-HTML. A CLI that runs checks and scoring on a labelled CSV and prints precision at top 50.
Done when: harness runs offline in CI.

**M5-S11 Tests**
Build: unit tests per check, golden scoring tests, SSRF tests, robots tests, rate-limit test, failure injection (timeouts, DB drops).

## Human-owned: decisions and manual work

**Developer decisions**
- **M5-D1** Language detection library: benchmark two or three free options (for example Lingua, a fastText-style model, langid) on fixture text for accuracy, speed and memory. Default: pick the best accuracy that fits the worker's memory.
- **M5-D2** HTML parser (`selectolax` default for speed).
- **M5-D3** Stemming strategy for non-English jobs (default: stem only when language has a supported Snowball stemmer, else exact match).
- **M5-D4** JavaScript-only detection heuristic and thresholds.
- **M5-D5** Worker egress IP: free hosts often have reputations that get blocked. Measure the could-not-check rate on a real sample (see M5-PM2).

**Developer manual work**
- **M5-DM1** Set the bot's user-agent contact page or email (from M5-P1) on a real URL.
- **M5-DM2** Run the calibration harness against the labelled set and report results.

**Product team decisions**
- **M5-P1** Bot name, User-Agent text and the contact page or email it points to.
- **M5-P2** Thresholds: thin content word count, outbound link limits, relevance minimum, language confidence, tier cut-offs, initial scoring weights, overlap boost curve, multi-query boost.
- **M5-P3** Confirm auto-filter list, G12 (Unchecked definition) and G14 (cap order, cache TTL).
- **M5-P4** Which fetch outcomes are "fail" versus "could not check" (default table in M5-S4).
- **M5-P5** Politeness limits (default one request per 2 s per domain).
- **M5-P6** Region match rules for "language or region match".

**Product team manual work**
- **M5-PM1** Provide the spam keyword lists, suspicious TLD list and banned category lists (per language where needed).
- **M5-PM2** **Label 100 to 200 sample URLs** as good or bad (a mix from competitor gap exports). This is the calibration set. Without it, weights are guesses.
- **M5-PM3** Provide contact and about page detection phrases per language.

**Exit criteria:** a gap-only job produces ranked Ready and Backlog lists with reasons. Fixture and calibration tests pass.

---

# MVP 6: Review workflow and export

**Goal:** reviewers work the top of the queue, verify externally, and mark Approved or Rejected with reasons. Every decision is captured for feedback.
**Needs:** M5.

## Build tasks

**M6-S1 Schema additions**
Build: on `opportunities`: `review_status` (New, In review, Approved, Rejected, Used), `reviewer_id`, `reviewed_at`, `notes`, `reject_reason` (spam, off_topic, no_link_option, already_have, other), `reject_scope`, `score_at_review`, `tier_at_review`, `external_metrics` jsonb (DR, traffic, notes and activity reviewer fields), `row_version` for concurrency. New append-only `opportunity_reviews` (opportunity_id, from_status, to_status, reject_reason, reviewer_id, score, tier, config_version, queue_group, source summary, at).
Done when: every review change writes a history row in the same transaction.

**M6-S2 Results screen**
Build, under the job's Results tab (permission `results.view`):
- tabs: **Ready for review** (default), **Backlog**, **Auto-filtered** (needs `results.view_filtered`), **All**
- columns: URL, domain, score, tier, **top 3 reasons**, source(s), overlap, activity, review status, flags (client link unknown, previously spam, already links to client, domain cap)
- filters: tier, activity, source, status, domain, query text, flags. Search, sort, keyset pagination
- **Group by domain** toggle (collapsible groups with count and best score)
Done when: 100,000 rows paginate fast, and the default screen shows only Ready rows.

**M6-S3 Row detail drawer**
Build: full score breakdown, every check with evidence, "found by" list (every query and source), fetch info and redirect chain, normalized and original URL, open-page link, one-click lookup links for the domain in Ahrefs, Semrush and GSC (plain links, no API), editable external metrics and notes.
Done when: nothing in the drawer renders fetched HTML (escape all text, A7 and XSS safety).

**M6-S4 Review actions**
Build: New to In review (soft claim with reviewer name, G13), In review to Approved or Rejected (**reject reason required**, note required for `other`, G20), Approved to Used, reopen with permission (logged). Bulk approve or reject with one shared reason after confirmation. Keyboard shortcuts and "next item" flow. Optimistic concurrency via `row_version` so two reviewers cannot overwrite each other.
Done when: concurrent edits return a clear conflict message.

**M6-S5 Reject scope effects (I14)**
Build: on Reject with `spam`, set the **global spam flag** on the domain (all future jobs flag it). Other reasons stay job-scoped. `off_topic` also writes a niche-scoped flag keyed by G8. Undoing the last spam rejection for a domain removes the flag. Flags feed M3-S5 at future discovery. Same-job rows of a newly spam-flagged domain show a banner offering bulk reject (product choice, M6-P3).
Done when: an esports off-topic reject never flags a travel job, and a spam reject flags every future job.

**M6-S6 Batch release and queue status**
Build: "Release next batch" button (`results.release_batch`), progress text ("12 of 50 pending"), and G5 behavior. Optional auto top-up when pending falls below a threshold (config, default off).

**M6-S7 Export (`results.export`)**
Build: CSV export of the current filter or a chosen status, selectable columns including external metrics. Streamed for large sets. **CSV formula-injection protection** (prefix cells starting with `=`, `+`, `-`, `@`). Export is logged in `job_events`.
Done when: an export opened in a spreadsheet never executes formulas.

**M6-S8 Tests**
Build: workflow tests for each transition, reject validation, scope rules, RLS per role (Viewer cannot review), concurrency conflict test, Playwright: open top of the queue, approve, reject with reason, export.

## Human-owned: decisions and manual work

**Developer decisions**
- **M6-D1** Pagination approach (default keyset on score and id).
- **M6-D2** Soft claim expiry for "In review" (default 30 minutes, then returns to New).
- **M6-D3** Domain grouping implementation (default SQL group query, no materialized view until slow).

**Developer manual work**
- None.

**Product team decisions**
- **M6-P1** Confirm G5, G13, G15, G17, G20 and the meaning of **Used** (default: link actually obtained).
- **M6-P2** Reviewer fields per activity and export columns and format.
- **M6-P3** When a domain is spam-rejected, should other rows of that domain in the same job be bulk-rejected, or only flagged? Default: flag with an offer.
- **M6-P4** Who can reopen decisions.

**Product team manual work**
- **M6-PM1** Write the reviewer guide: how to verify with Ahrefs, Semrush, GSC and what counts as approve versus reject for each reason.
- **M6-PM2** Train reviewers on the screen before UAT.

**Exit criteria:** reviewers can work a full gap job end to end. All decisions are stored with score, tier, reason and config version.

---

# MVP 7: Feedback reporting and blocklist

**Goal:** turn review decisions into the success metric and per-source, per-template, per-activity and per-tier approval rates. One-click blocklist.
**Needs:** M6.

## Build tasks

**M7-S1 Metric definitions and queries**
Build SQL views or functions (per job and overall):
- **Top-50 approval rate** (G16), the headline success measure
- approval rate = (Approved + Used) / (Approved + Used + Rejected), per source, per query template (via `opportunity_sources` joined to `job_queries`), per activity, per score tier
- reject-reason breakdown, decided counts, review throughput, undecided counts
- low-sample warning when decided count is below a threshold (default 20)
Done when: a seeded dataset gives hand-checked values.

**M7-S2 Reports UI (`reports.view`)**
Build: Report tab per job and an overall Reports page. Date, job and activity filters. Tables with simple charts (`recharts`). CSV export of report tables.
Done when: the top-50 approval rate is the first number on the page.

**M7-S3 One-click blocklist**
Build: from a rejected row or domain, "Add to global blocklist" with reason, scope shown, undo within the session. Uses `blocklist.manage`. Optionally flag existing rows of that domain in open jobs.
Done when: blocklisted domains are auto-filtered on the next discovery (M3-S4).

**M7-S4 Data capture audit**
Build: a check script that verifies every decided row has a decision history row, score at review, reject reason and scope. Data dictionary for later retuning (Phase 2).

**M7-S5 Tests**
Build: metric unit tests with edge cases (zero decisions, only Used), RLS tests, Playwright: view report after reviews.

## Human-owned: decisions and manual work

**Developer decisions**
- **M7-D1** Views versus functions versus materialized refresh (default plain views until slow).

**Developer manual work**
- None.

**Product team decisions**
- **M7-P1** Confirm G16 and the minimum sample size.
- **M7-P2** Which reports leadership needs weekly, and the reporting period.

**Product team manual work**
- **M7-PM1** Review a sample report and confirm the numbers match a hand count.

**Exit criteria:** reports match hand-calculated values. Blocklist from review works.

---

# MVP 8: Footprint search via Serper, budget and saturation

**Goal:** the second source. Generate queries from activity templates, run them through Serper within budget, record results, stop on saturation.
**Needs:** M3, M5. (M6 helps for evaluating results.)

## Build tasks

**M8-S1 Search provider interface (A10)**
Build: `SearchProvider.search(query, gl, hl, location, num, page) -> {results[], credits_used, meta}`. Implement `SerperProvider` (API key only in the worker env) and `FakeProvider` for tests (replays fixture JSON). Error taxonomy: auth, rate limit, server, timeout. Retry with backoff. Store only URL, title, snippet, position per result. No raw JSON by default.
Done when: swapping providers needs no change outside `providers/`.

**M8-S2 Credit verification script (human-gated, spec Section 6.1)**
Build: a script that makes a small number of approved test calls to measure credits consumed for `num=10`, larger `num` and `page=2`, and prints a table. Results are saved as settings documentation. **Do not run in CI.**
Done when: the table exists and the budget logic (M8-S5) reads credits from the per-call response, never from an assumption.

**M8-S3 Query schema and generator**
Build: `job_queries` (job_id, activity_key, template_id, template_version, query_text, params gl, hl, location, num, page, priority, status pending|running|done|failed, attempts, lease fields, credits_used, result_count, new_unique_domains, error, completed_at). Generator expands each enabled activity's templates with keywords, niche, brand variants, country, language, cities and regions. Normalize whitespace, dedupe, and interleave so early queries are diverse (many different queries, not deep paging). Warn and cap on cartesian explosion relative to budget.
Done when: queries are generated up front as individual rows and totals appear in `queries_total`.

**M8-S4 Search executor**
Build: claims a query row (same lease and `SKIP LOCKED` pattern), calls the provider, stores results through `record_discovery` (`source_type=google`, `source_ref=query id`), applies job blocklist, writes credits used as **reported on the call**, `result_count`, `new_unique_domains` (G11). Pages beyond the first are separate paid calls (`pages_per_query`). Retries are idempotent. Max attempts, then `failed`.
Done when: killing a worker mid-call retries the row without duplicate opportunities (credits may be re-spent once, documented).

**M8-S5 Budget enforcement (I5)**
Build: before each claim, ensure `credits_used + worst-case in-flight credits <= budget`. Search concurrency default 2 to bound overshoot. When the budget is reached, stop claiming queries, drain checks, mark Completed with reason `budget_reached` (G4).
Done when: a concurrency test with a fake provider never exceeds budget by more than the documented bound.

**M8-S6 Saturation rule**
Build: after each completed query, take the last N completed queries (job `saturation_n`) and sum `new_unique_domains`. If the sum is below `saturation_x`, set the job to **Saturated** (auto-pause for queries, G3 and G4). Only evaluate when at least N queries are done. Applies to Google search only, never to the CSV source.
Done when: unit tests cover thresholds, resume re-evaluation and failed rows being ignored.

**M8-S7 Queries tab and live counters**
Build: queries table with status, credits, result count, new domains, error, per-template yield. Retry failed rows. Counters from M3-S8 now show credits and queries live.

**M8-S8 Search-specific checks and flags**
Build: multi-query boost input for scoring (distinct queries per opportunity) wired into M5-S7. Flag `already_links_to_client` (G18) when a client CSV exists.
Done when: an opportunity found by three queries scores higher than the same one found by one, other inputs equal.

**M8-S9 Scrape fallback stub (Phase 2 hook)**
Build: provider method signature and job field `scrape_credit_cap` (default 0). No code path active. Do not enable until credit cost is confirmed.

**M8-S10 Tests**
Build: fake-provider end-to-end (generate, search, check, score, queue), budget concurrency test, saturation tests, crash tests, query generator property tests.

## Human-owned: decisions and manual work

**Developer decisions**
- **M8-D1** Results per call and pages per query defaults, chosen after M8-S2 results.
- **M8-D2** Search concurrency and rate limiting to match the Serper plan limits.
- **M8-D3** How `cities or regions` map to Serper's `location` parameter.

**Developer manual work**
- **M8-DM1** Create the Serper account and API key. Put the key only in the worker environment.
- **M8-DM2** Run the credit verification script with product approval and record the table (**blocks budget finalization**).

**Product team decisions**
- **M8-P1** Approve test spend for credit verification.
- **M8-P2** Set production budget per job type after credit costs are known.
- **M8-P3** Confirm G3, G4, G11 and the default saturation values (spec marks them for confirmation after first runs).
- **M8-P4** Confirm that `already_links_to_client` should be a flag, not a filter (G18).

**Product team manual work**
- **M8-PM1** Finalize footprint templates per activity and per language, including operators (`intitle:`, `inurl:`, quoted phrases), and mark priority order.
- **M8-PM2** Provide real seed keywords, brand variants and niche terms for the pilot job.

**Exit criteria:** a job runs gap then search to completion, saturation, or budget, with correct credit accounting.

---

# MVP 9: Hardening, deployment and UAT

**Goal:** production-ready: secure, observable, deployed on free-tier-compatible infrastructure, and accepted by the product team.
**Needs:** M1 to M8.

## Build tasks

**M9-S1 Security review**
Build: short threat model (`docs/security.md`) covering: SSRF (A7), CSV injection, XSS from fetched titles and snippets, RLS bypass and role escalation, service-key leakage, storage bucket access, invite and reset flows, login rate limiting. Fix findings. Enable dependency audit (`pip-audit`, `npm audit`) and secret scanning in CI.
Done when: each threat has a control and a test or a documented acceptance.

**M9-S2 Observability and admin health page (`system.view_health`)**
Build: structured logs with correlation ids, `job_events`, worker heartbeats, health page showing worker status, queue depth by status, failed rows with reasons, jobs stuck without progress for a configurable time, last errors. Alerting method per M9-D2.
Done when: a killed worker is visible as offline within two minutes, and a stuck job is flagged.

**M9-S3 Performance and storage review**
Build: load test with 200,000 opportunities and 500,000 CSV rows. Verify indexes with `EXPLAIN`. Estimate database size per 100,000 opportunities and compare with the free-tier limit. Implement retention for staging `csv_rows` (purge after import confirmed) and for fetch evidence. Do not store page bodies (G19).
Done when: a size projection and retention policy are documented.

**M9-S4 Deployment**
Build: production Dockerfile, deploy workflow (GitHub Actions), environment separation (staging and production if M0-DM3 allowed), migration process (`supabase db push` from CI with approval), rollback steps, worker restart policy, automated nightly logical backup to free storage.
Done when: a tagged release deploys web and worker, and a rollback is rehearsed once.

**M9-S5 Runbooks**
Build in `docs/runbooks`: start and stop the worker, stuck job, failed rows, rotate Serper key, restore from backup, add a user or role, add an activity, tune weights, add to blocklist, Supabase paused-project recovery.

**M9-S6 Documentation**
Build: user guide (job form field by field, uploads, review, reports), data dictionary, reason-code catalog, ADR index, permission catalog.

**M9-S7 UX polish and accessibility**
Build: empty, error and loading states everywhere, keyboard navigation in review, basic WCAG checks on contrast and focus.

**M9-S8 End-to-end suite**
Build: Playwright happy path: create role, create user, create job, upload CSVs, start, review, report, export.

**M9-S9 Pilot support tooling**
Build: a script that prints the pilot summary: counts per group, top-50 approval rate, could-not-check rate, credits per approved opportunity.

## Human-owned: decisions and manual work

**Developer decisions**
- **M9-D1** Staging strategy (separate project, or local only).
- **M9-D2** Alerting channel that costs nothing (default: health page plus a daily email or chat webhook from a scheduled job).
- **M9-D3** Backup destination and frequency.

**Developer manual work**
- **M9-DM1** Provision the production worker host, deploy, and verify it stays up for 72 hours without sleeping.
- **M9-DM2** Set production secrets, redirect URLs, custom domain and TLS.
- **M9-DM3** Check Supabase free-tier health: size, connections, inactivity pause. Report to product (spec open item 2).
- **M9-DM4** Rehearse backup restore.

**Product team decisions**
- **M9-P1** Approve go-live after UAT.
- **M9-P2** If free tiers prove insufficient, decide on any paid plan **before** building around it (spec Section 2).

**Product team manual work**
- **M9-PM1** Run UAT with the script from M9-S8 and log defects.
- **M9-PM2** **Pilot job:** one real client, competitor and client CSVs, small Serper budget. Review the top 50. Record approval rate and what reviewers reject most.
- **M9-PM3** Review default values (saturation, caps, weights) against pilot data (spec open item 3).
- **M9-PM4** Onboard real users and roles.

**Exit criteria:** security review done, deployed, runbooks written, pilot completed, product sign-off.

---

# MVP 10: Phase 2 backlog (not built in the first release)

Schema and code already leave room for these. Do not build now.

| Item | Prepared by | Notes |
|---|---|---|
| More activities (forum, directory) | Activity profiles (M2-S8) | Config plus any new page-type check as a small dev task |
| Bulk import of Ahrefs and Semrush metrics | `external_metrics` jsonb (M6-S1) | CSV import matched by normalized URL or domain, with a mapping screen like M4 |
| Serper scrape fallback | `scrape_credit_cap` and provider stub (M8-S9) | Only after credit cost is confirmed. Separate credit cap |
| Random backlog sample | Review history (M6-S1) | Small random sample from Backlog so labels cover more than top-scored rows |
| Score retuning from review data | Decision history and data dictionary (M7-S4) | Weight changes made by admins, never automatic |
| New job types (web research, keyword discovery) | `job_type` field, modular code | Build a shared generic engine only when a second job type is defined, with data sources decided first |
| Paid authority or traffic data for top results only | Provider-style interface | Needs cost approval and a spec change to the cost rule |

---

## 3. Dependency order at a glance

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6 ──► M7
                      │               │
                      └───────────────┴──► M8 ──► M9 ──► (M10 later)
```

Parallel options: M4 file reading and mapping UI can start after M3-S3. M8-S1 to M8-S3 can start after M3 while M5 is in progress. Reports (M7) can start once M6-S1 is done.

## 4. Critical human items (block engineering if late)

| Item | Needed by |
|---|---|
| M0-D2 always-on worker host | M3-DM1 (first deploy), M9 |
| M0-DM1 Supabase plan limits checked | M3, M9-S3 |
| M2-PM1 activity profile content, M2-PM2 banned lists | M5 |
| M4-PM1 real CSV exports from Ahrefs, Semrush, GSC | M4-S3 |
| M5-P1 bot name and contact page | M5-S1 (production) |
| M5-PM1 spam lists, M5-PM2 labelled calibration set | M5-S7 tuning, M9 pilot |
| M8-DM1 Serper account, M8-DM2 credit verification | M8-S5 budget finalization |
| M9-DM1 72-hour uptime proof of the free worker host | Go-live |