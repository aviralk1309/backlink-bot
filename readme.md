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
| Product team | View results, review and verify opportunities, upload CSVs, export |
| Viewer | Read-only |

Roles are enforced with Supabase row-level security. The bot workers use a server-side service key and are never exposed to the browser.

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
- **Pause** stops workers from claiming new rows. **Resume** continues. **Stop** ends the job. A worker crash only loses the row in progress, which is retried.
- **Statuses:** Draft, Queued, Running, Paused, Completed, Failed, Saturated
- **Live counters:** credits used vs budget, queries done vs total, unique opportunities found, duplicates skipped, unchecked count
- **Saturation rule (default):** if the last N completed queries (default 20) added fewer than X new unique domains (default 3), the job auto-pauses as Saturated. N and X are configurable per job. This applies to Google searches only, not to the competitor CSV source.
- A job stops on its own when the query list is finished, the credit budget is reached, or it is saturated.

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

**Phase 1 (MVP), in build order:**
1. Job form, job controls, dynamic roles and permissions (role builder screen) with three starter roles
2. **Competitor gap first:** competitor and client CSV uploads, mapping templates, domain-level gap
3. URL normalization, free checks, scoring, ranking, review queue, domain grouping
4. Review workflow with reject reasons, export, basic feedback reporting
5. Footprint search (Serper) for guest post and resource page

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