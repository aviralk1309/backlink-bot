# Backlink Discovery Bot: Product Overview (v2, revised)

## 1. Purpose

A dashboard-driven bot that finds new backlink opportunities for a client website, ranks them, and stores them in a database. The product team then verifies the best ones using Ahrefs, Semrush and Google Search Console (GSC), which they already have.

The bot discovers and ranks. People decide.

**Success measure:** reviewers can open the top of the list and find mostly worthwhile opportunities. The bot is judged on the **approval rate of its top 50 results**, not on how many rows it stores.

---

## 2. Cost rule

Serper is the only paid service. Everything else must run free or on infrastructure already owned.

- No paid LLM, paid crawler, proxy, or SEO API calls in the bot.
- Serper credits are used for Google searches. An optional Serper scrape fallback (section 6.3) is off by default and has its own separate credit cap.
- Page checks use plain HTTP fetches from our own worker server, with free Python libraries and rule-based scoring.
- **Assumption:** Supabase, dashboard hosting and the worker server use free tiers or existing accounts. If any of these needs a paid plan, flag it before building. A continuously running worker needs an always-on host, and free hosting often sleeps, so check this first.

---

## 2.5. Business invariants

These rules must hold in every MVP:

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

## 2.6. Spec gaps and defaults

These gaps were identified during MVP planning and have default resolutions:

| ID | Gap | Default |
|---|---|---|
| G1 | "Stop ends the job" but no "Stopped" status exists | Add terminal status `Stopped` |
| G2 | "Failed" is never defined | Job becomes Failed only on unrecoverable config/system error, or when every query row fails |
| G3 | "Saturated" auto-pause - is it resumable? | Yes, with confirmation |
| G4 | When Saturated/budget-reached/Stopped, do pending checks finish? | Stop halts everything; Saturation stops new queries only, pending checks drain |
| G5 | How does "Ready for review" top 50 behave? | Ready holds at most N undecided rows; new higher-scored rows never evict shown rows; "Release next batch" pulls from Backlog |
| G6 | Job form has "reference sites", "own seed lists", "competitor domains" | Seed list URLs imported as opportunities; competitor domains label CSV uploads and are excluded; reference sites stored and excluded |
| G7 | "Local business data" has no use in v1 | Stored on job only; not used by v1 query templates |
| G8 | Off-topic reject is niche-scoped - what is the niche key? | Normalized (business_type, sub_niche) |
| G9 | Difference between "spam-rejected flag" and "global blocklist" | Flag = warning with per-job skip option; Blocklist = hard auto-filter, never fetched |
| G10 | Overlap boost counts what? | Distinct competitor labels linking to the domain |
| G11 | "New unique domain" for saturation | A registered domain not yet seen in this job from any source |
| G12 | What makes a result "Unchecked"? | Any essential check returns could-not-check, or domain check cap hit |
| G13 | Reviewer assignment not in spec | "In review" is soft claim by one reviewer with visible name; no hard assignment |
| G14 | Domain cache lifetime and per-domain cap URL priority | TTL 7 days; first N URLs by: overlap count desc, multi-query count desc, discovery order |
| G15 | Who can add to blocklist and mark "Used"? | Permission-based: `blocklist.manage` and `results.review` |
| G16 | Success metric exact definition | Top-50 approval rate = (Approved + Used) / (Approved + Used + Rejected) among first Ready batch rows with a decision |
| G17 | Backlog release batch size | 25 rows |
| G18 | Client CSV exists - Google results from domains already linking to client | Flag `already_links_to_client`; not removed |
| G19 | Data retention and storage size | Never store page bodies; store title, meta, headings snippet and signals only |
| G20 | Reject reasons - "other" needs a note? | Note required when reason = other |

---

## 3. How it works

1. An admin creates a **Search Backlinks** job and fills in the job form.
2. The product team uploads the competitor backlinks CSV and the client's own backlinks CSV for the competitor-gap source.
3. The admin starts the job.
4. The bot finds opportunities, runs free checks, scores them, and stores the results. **Competitor gap runs first**, then Google footprint search adds more.
5. The product team reviews from the top of the ranked queue, verifies in Ahrefs / Semrush / GSC, and marks each Approved or Rejected with a reason.
6. Review decisions feed back into reporting on which sources and query types work (section 10).

---

## 4. Dashboard and users

The dashboard has a **Jobs** section in the navbar, where users create, edit, start and monitor jobs.

Roles and permissions are **fully custom and dynamic**, and the role builder screen is part of the MVP. Admins create, edit and delete roles and choose exactly what each role can do. Three starter roles are pre-created and can be edited. The Admin role cannot be deleted or stripped of role-management permission, so nobody can lock themselves out.

| Starter role | Access |
|---|---|
| Admin | Create, edit, delete and start jobs; manage users and assign roles |
| Manager | Reviews and verifies results, uploads CSVs, exports, manages the blocklist |
| Viewer | Read-only |

Roles are enforced with Supabase row-level security. The bot workers use a server-side service key and are never exposed to the browser.

**Note:** The "Manager" role replaces the earlier "Product team" terminology. See [MVP 1](#) for the permission catalog.

---

## 5. Job form (inputs)

All fields can be edited, added or removed after the job is created. Edits apply to future queries and checks only, and do not rewrite results already stored.

- **Basics:** job name, client, client domain, target URLs, business type, sub-niche (for example esports gaming, travel)
- **Activities in scope:** one or more from the v1 list (see section 13)
- **Targeting:** country, language, cities or regions, seed keywords, brand name and variants
- **Discovery sources:** competitor domains, reference sites, own seed lists
- **Filters:** banned categories, blocked domains (plus a global blocklist), language or region match
- **Limits:** maximum Serper credits (budget), pages per query, saturation rule, per-domain cap, size of the review queue (default 50)
- **Local business data** (only if relevant): business name, address, phone

---

## 6. What the bot does

### 6.1 Google footprint search (via Serper)

- Query templates are defined per activity (for example guest post footprints differ from resource page footprints) and combined with the job's keywords, niche, brand variants, country and language.
- The query list is generated up front and stored as individual rows, each with its own status (section 8). Depth comes from running many different queries, not from going deep on one.
- **Verify before finalizing the budget:** how many results one Serper credit actually returns, and the credit cost of requesting more results or further pages. The budget is counted in credits actually consumed, as reported by Serper on each call, not in assumed queries.

### 6.2 Competitor gap (CSV), built first

Two uploads are needed:

- **Competitor backlinks CSV(s):** from Ahrefs, Semrush or similar.
- **Client backlinks CSV:** from GSC (Links report) or Ahrefs. Without this, "links to competitors but not to the client" cannot be calculated. A GSC export is partial, so some gaps may be false. If no client file is uploaded, results are flagged "client link status unknown".

Rules:

- Only the **URL** column is required. Other columns are optional and stored as extra information.
- A mapping screen lets the team say which column is the URL and label the rest. Mappings can be saved as templates.
- The gap is calculated at domain level: domains linking to competitors that do not link to the client.
- **Overlap boost:** a domain that links to several competitors ranks higher. This is a free and strong signal.
- Uploaded rows are validated (bad URLs, empty rows) and the team sees an import summary.

### 6.3 Free checks on each result

Checks use plain HTTP fetches and free libraries. Each check returns pass, fail, or could-not-check, plus a reason code.

- Page loads (status, redirects, timeout)
- Not blocked from indexing (noindex, robots rules)
- Language matches the job (free language-detection library)
- Relevance to the niche: keyword matching against title, meta, headings and body text using the job's seed keywords
- Basic spam signals (rule-based): excessive outbound links, thin content, spam keyword lists (casino, pharma and so on), no contact or about page, suspicious TLDs
- Activity fit: page-type signals for the chosen activity (for example "write for us" for guest posts, "useful links" or "resources" page structure for resource pages)

Important behaviors:

- **"Could not check" is not "fail."** Sites blocking our fetcher (Cloudflare, JS-only pages, timeouts) are marked unchecked with a reason. They stay in the list and are ranked lower, not hidden as junk.
- Fetching is polite: identifies itself, respects robots.txt for crawling, and rate-limits per domain.
- Plain HTTP only in v1. No headless browser.
- Optional fallback: Serper's scrape endpoint for blocked pages. Off by default, controlled by a separate credit cap on the job, and only enabled after confirming its credit cost.
- Checks are cached at domain level where sensible, so one site is not re-fetched endlessly.

### 6.4 Scoring and tiers

Every opportunity gets a **score (0 to 100)** and a **tier label** (High, Medium, Low, Unchecked), built from the free checks and source signals, for example:

- Relevance to niche (highest weight)
- Language and region match
- Activity fit
- Spam signals (negative)
- Competitor overlap count (boost, for gap results)
- Appearing for multiple different queries (boost)

The score breakdown is stored with reason codes, and the top 3 reasons are shown on each row (for example "links to 3 competitors, has guest-post page, on-topic"). The weights are configuration, not hard-coded, so they can be tuned from review results.

The score is for **ordering**, not a quality verdict. Without authority or traffic data the bot can only catch obvious junk. The team's Ahrefs / Semrush / GSC check remains the real quality gate.

### 6.5 Review queue

Human review is the bottleneck, so reviewers do not get one long list. Results fall into three groups:

1. **Auto-filtered (hidden by default):** clear failures such as a dead page, blocked from indexing, wrong language or banned category. Each shows its reason and can be viewed on demand. Nothing is silently deleted.
2. **Ready for review:** the top results by score (default 50 per job, adjustable). This is the default screen for reviewers.
3. **Backlog:** everything else that passed, released into the review queue in batches as the team clears the top. Unchecked results sit here, ranked lower.

Tiers (High, Medium, Low, Unchecked) are labels shown on each row. They do not replace the queue.

### 6.6 Storage

Everything is stored in the database, including failed and unchecked results (marked as such).

---

## 7. Duplicate and URL rules

- **URL normalization before storing:** lowercase host, strip www, unify http/https, remove fragments and tracking parameters (utm_ and similar), remove trailing slashes, and resolve obvious redirects when fetched. The original URL is kept as well. A second check after the page loads catches redirects and canonical URLs that point to a link already stored.
- **No duplicates within a job:** unique on (job, normalized URL). A repeat discovery adds the new query or source as an extra "found by" record and counts toward the duplicates-skipped counter.
- The same link can appear in different jobs.
- **Domain handling:** all URLs are stored, but check effort is limited to a configurable number per domain (default 10 per job). The dashboard groups results by domain so one site cannot flood the review list. Activity-specific caps (for example 1 to 3 for guest posts and resource pages) can be set per activity.
- Domains already rejected as spam in a previous job are flagged on discovery, with a job option to skip them (see section 10 for scope).

---

## 8. Job engine and controls

- **Work units:** every query is a row (pending, running, done, failed). Workers claim rows from Postgres using `FOR UPDATE SKIP LOCKED`. No extra queue service is needed. Each claimed row has a lease time, so rows left "running" by a crashed worker return to the queue automatically.
- **Pause** stops workers from claiming new rows. **Resume** continues. **Stop** ends the job with a new **Stopped** terminal status. A worker crash only loses the row in progress, which is retried.
- **Statuses:** Draft, Queued, Running, Paused, Completed, Failed, Saturated, **Stopped**
- **Live counters:** credits used vs budget, queries done vs total, unique opportunities found, duplicates skipped, unchecked count
- **Saturation rule (default):** if the last N completed queries (default 20) added fewer than X new unique domains (default 3), the job auto-pauses as Saturated. N and X are configurable per job. Saturation is resumable (resume asks for confirmation) and is re-evaluated after N more completed queries. This applies to Google searches only, not to the competitor CSV source.
- A job stops on its own when the query list is finished, the credit budget is reached, or it is saturated.
- **Stop vs Saturation behavior:** Stop (explicit) halts everything, including checks. Saturation and budget-reached stop claiming new queries only; pending checks drain so found results get scored.

**State machine transitions:**
| From | Action | To | Who |
|---|---|---|---|
| Draft | start | Queued | `jobs.start` |
| Queued | worker picks up | Running | worker |
| Running | pause | Paused | `jobs.control` |
| Paused | resume | Running | `jobs.control` |
| Running/Paused/Saturated | stop | Stopped | `jobs.control` |
| Running | auto | Saturated/Completed/Failed | worker |
| Saturated | resume | Running | `jobs.control`

---

## 9. What is stored for each backlink

- URL, normalized URL, domain
- Job, query, and source (Google or competitor CSV), including every query or source that found it
- Check results, reason codes, score and tier
- Competitor overlap count (for gap results)
- Review status (New, In review, Approved, Rejected, Used), reviewer, notes
- **Reject reason** (required when rejecting): spam, off-topic, no link option, already have, other
- Space for the team's Ahrefs / Semrush / GSC findings (for example DR, traffic, notes), which can also be bulk-filled by CSV import

---

## 10. Feedback loop

Review decisions are the most valuable data the system produces.

**Captured from day one:**
- Every Approved or Rejected decision, with its reject reason and the score at the time of review.
- **Reject scope:** spam rejections apply globally (the domain is flagged in all future jobs). Off-topic rejections apply only to that job's niche, so an esports reject never blocks a travel job.

**v1 reporting:**
- Approval rate per source, per query template, per activity, and per score tier, shown per job and overall.
- Rejected domains can be added to the global blocklist with one click.

**Later:**
- Use the approval data to retune score weights and drop weak query templates automatically (weight changes are made by admins, never automatically).
- **Random backlog sample:** show reviewers a small random sample from the backlog, so labels come from more than the top-scored rows and the score can be tested properly.

---

## 11. Data design

- One shared set of tables for all jobs. Every row carries a job id, and each job shows as its own filtered view in the dashboard.
- **Main tables:** jobs, job_queries, opportunities, opportunity_sources (found-by records), domains (domain-level check cache), csv_uploads, mapping_templates, blocklist, user profiles, **roles, permissions, role_permissions**.
- Core columns are real columns. A flexible JSON field holds job-specific extras and uploaded CSV extra columns.
- Access controlled by role and row-level security.

---

## 12. Tech stack

- **Bot / workers:** Python (httpx, free parsing and language-detection libraries)
- **Database:** Supabase (Postgres), used also as the job queue
- **Dashboard:** Next.js
- **Search data:** Serper (SERP API), behind a provider interface so it can be swapped
- The long-running bot runs on its own server or container, separate from the dashboard.

---

## 13. Activities

Query templates, page-type checks and per-domain caps all depend on the activity, so this is a build prerequisite.

**v1 activities: guest post and resource page.**

Each activity is an **activity profile**, a configuration of: footprint templates, page-type signals, relevance rule, scoring weights, per-domain cap and reviewer fields. Profiles are managed from the dashboard. Admins can add, edit, enable or disable an activity as business needs change. A genuinely new kind of page check may need a small development task.

Forum, directory and others are added the same way in later phases.

---

## 14. Scope and phases

The project is split into 11 MVPs (M0 to M10). Build order follows spec Section 14: roles first, then competitor gap, then checks and review, then Serper search. Parallel work is possible where dependencies allow.

**MVP Map:**
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

**Build order (Phase 1 - MVP):**
1. **M0:** Foundation - repository, tooling, Supabase, scaffolding, CI, containerization
2. **M1:** Identity - roles, permissions, authentication, user management, role builder
3. **M2:** Jobs - job form, activity profiles, job lifecycle, blocklist
4. **M3:** Pipeline - URL rules, storage, worker engine, counters
5. **M4:** Competitor gap - CSV uploads, mapping, gap calculation
6. **M5:** Free checks - HTTP fetcher, scoring, tiers, queue groups
7. **M6:** Review workflow - approval/rejection, export, feedback capture
8. **M7:** Feedback reporting and blocklist management
9. **M8:** Footprint search - Serper integration, budget tracking, saturation
10. **M9:** Hardening - deployment, UAT, production readiness

**Phase 2:**
- More activities (forum, directory)
- Bulk import of Ahrefs / Semrush metrics
- Serper scrape fallback (if its cost is acceptable)
- Random backlog sample and score retuning from review data

**Later:**
- New job types (web research, keyword discovery). The `job_type` field and separate code modules per type keep this possible, but a shared generic engine is built only when a second job type is actually defined, with its data sources decided up front.
- Optional paid authority or traffic data for the top-ranked results only.

---

## 15. Open items

1. Serper plan and credit budget for production, plus verified results-per-credit
2. Confirm hosting for dashboard, database and an always-on worker stays within free tiers
3. Confirm default saturation values and per-domain cap with real job data after the first runs
4. MVP split of the full project, if different from section 14

---

## 16. Architecture Decision Records (ADRs)

Key architectural decisions documented in `docs/adr/`:

| ADR | Decision | Rationale |
|-----|----------|-----------|
| 0001 | Modular monolith | Single deploy unit, shared infrastructure |
| 0002 | Postgres as queue | No extra service, uses `FOR UPDATE SKIP LOCKED` |
| 0003 | Direct PG worker | Worker talks to Postgres directly with `psycopg` |
| 0004 | Permission catalog | Centralized, migration-controlled permissions |
| 0005 | Config versioning | Job edits create new `config_version`; never rewrite results |
| 0006 | Opportunity state machine | Pipeline per opportunity as state machine |
| 0007 | Fetcher SSRF guards | Security for URL fetching |
| 0008 | CSV in worker | Avoids web request timeouts |
| 0009 | Polling counters | Dashboard polls counters every few seconds |
| 0010 | Search provider interface | Swappable search backends |
| 0011 | Local-first hosting | Development convenience |
| 0012 | roles.manage is admin-equivalent | Simplifies permission model |
| 0013 | Forbidden page status | No access page returns 200 status |

See `docs/adr/README.md` for the full list and details.
