# Browser QA report — 29 October 2026

## Verdict

**Not release ready.** Core authorization, review decisions, CSV validation, and the worker import path work in the local environment. Six product issues need attention, including a job-edit data-loss case. The existing production-build browser suite passed **20/20**, but its coverage does not include the failures below.

**Follow-up:** All six product findings below now have fixes. Browser regressions reproduced the failures and passed after the fixes. The cleanup check verifies both the CSV and error report are removed; SQL and worker tests cover the durable retry queue. The original audit observations are preserved here for context.

This was a hands-on browser pass against local Next.js and Supabase, using seeded Admin/Viewer accounts and disposable Manager, role, activity, jobs, and CSV files. I also ran the repository's Playwright E2E suite against its separate production server. The two disposable jobs and all QA accounts, role, activity, synthetic opportunities, spam flag, and uploaded objects were removed afterward. Existing user data was not reset.

## Findings, in fix order

### P1 — Editing a Draft can erase previously saved settings

**Observed:** I saved client domain, business type, India/English, a seed keyword, and Guest post on `QA Browser CSV Flow`. The overview showed only `no_source`, proving those fields were present. I then reopened Edit, added `rival-a.com` and `rival-b.com` competitor chips, and saved. The job's persisted Settings showed the two competitors but `Not set` for the earlier client, targeting, keyword, and activity fields. Start then reported all those fields missing. A hard reload of Edit showed empty controls. On client navigation before the hard reload, Edit displayed the old filled values, which makes this especially easy to miss.

**Impact:** A normal follow-up edit can silently discard a substantial part of a job configuration. The version/conflict guard did not catch this same-session loss.

**Cause:** [job-form.tsx](../apps/web/src/features/jobs/job-form.tsx) initializes controlled form state with `useState(values)`, while the [edit page](../apps/web/src/app/%28app%29/jobs/%5Bid%5D/edit/page.tsx) keyed the form only by job ID. Next preserved the client component across navigation, so it retained stale fields when new server values arrived.

**Resolution:** The edit form now keys its state by job ID and saved `updated_at`, so a new saved version remounts with current values. The browser regression covers a second edit and verifies persisted fields.

### P1 — Live job progress polls a missing route

**Observed:** On queued jobs the overview repeatedly showed `Live updates are paused. Retrying.` The browser console recorded `GET /api/jobs/<job-id>/stats 404`. Progress counters did not update live.

**Cause:** [live-stats.tsx](../apps/web/src/features/jobs/live-stats.tsx) fetched `/api/jobs/${jobId}/stats`, while the route is at [jobs/[id]/stats/route.ts](../apps/web/src/app/%28app%29/jobs/%5Bid%5D/stats/route.ts), which serves `/jobs/<id>/stats`.

**Impact:** Operators cannot rely on the job overview while work is running. The eventual status does appear after a full navigation/reload.

**Resolution:** The poll now uses `/jobs/${jobId}/stats`. The browser test checks that a queued job shows a successful live update.

### P2 — Confirmed competitor CSVs do not make a job startable

**Observed:** A Draft with all other required settings, two confirmed competitor CSVs, and a confirmed client CSV showed a two-domain gap preview. Start still failed with `Add a source: a Serper credit budget above 0, seed list URLs or competitor domains.` Adding competitor-domain chips for the same two files made it Ready to start. The worker then imported three distinct linking pages and completed the job.

**Impact:** The upload workflow produced a valid preview but required users to repeat competitor domains in job settings.

**Resolution:** `job_start_problems` now counts a confirmed competitor CSV with at least one nonduplicate valid row as a source. Unconfirmed, client, and zero-valid-row files do not count. The [manual UI guide](manual-ui-test-guide.md) and source checklist are updated. The browser test starts and imports a CSV-only job with zero search budget and no competitor chips.

### P2 — Deleting a job leaves its CSV files in Storage

**Observed:** After deleting the completed CSV QA job through its UI, the job and upload database records were gone, but six objects remained in the `csv-uploads` bucket under that job ID. I removed those six QA objects through the Storage API and verified the folder was empty.

**Cause (code inspection):** [deleteJobAction](../apps/web/src/features/jobs/actions.ts) deletes the `jobs` row but does not remove its Storage objects. Individual CSV deletion has a separate best-effort Storage removal in [csv/actions.ts](../apps/web/src/features/csv/actions.ts).

**Impact:** Job deletion does not fully delete uploaded backlink data and error reports; Storage usage and data-retention exposure grow over time.

**Resolution:** The delete action now removes every object under the deleted job's Storage folder. A database trigger records a cleanup target in the same transaction as any job deletion; the worker retries failed Storage cleanup. The browser regression verified that both a CSV and its validation report disappear. Historical orphan files from deletions before this fix are not swept automatically.

### P2 — Visible Reports navigation leads to 404

**Observed:** The sidebar displayed Reports for an authenticated Viewer. Clicking it opened `/reports`, which returned the framework 404 page. No Reports route exists in the current app tree.

**Impact:** Users are led to an unavailable feature. Hide the link until the page exists, or deliver the page.

**Resolution:** Reports was removed from the shared navigation list and sidebar icon map. The `reports.view` permission remains available to existing roles; a browser check verifies that it no longer produces a link to the missing route.

### P2 — A CSV with zero valid rows can be marked Confirmed

**Observed:** `04-all-invalid.csv` validated as 2 total / 0 valid / 2 invalid. `Confirm import` remained enabled and changed its status to Confirmed. The gap preview correctly stayed at two domains, but the file's status now suggests it contributed usable data.

**Impact:** Reviewers can accept an empty competitor export and may assume it was included in analysis. Disable confirmation or make the zero-usable-row state explicit.

**Resolution:** A ready CSV now needs at least one nonduplicate valid row before the database will confirm it. The upload list says No usable rows, and the review modal explains how to correct the file instead of showing Confirm import. Browser and SQL regressions cover the all-invalid case; SQL also covers all-duplicate rows and preserves confirmation for usable files.

### P3 — Noisy browser errors and stale documentation

- The Manager session logged `/api/system/workers 403` during normal navigation. The permission denial is appropriate; avoid polling when the role cannot view worker health.
- Changing Results filters triggered a Base UI uncontrolled `FieldControl` default-value warning at [results-panel.tsx](../apps/web/src/features/results/results-panel.tsx). Search, clear, and grouping still worked in this pass; I did not reproduce a user-visible filter mismatch.
- [manual-ui-test-guide.md](manual-ui-test-guide.md) describes the build as M0–M4/M5-S1 and says there is no Results UI. It is stale against the current M6 review screen.

**Resolution:** The topbar mounts worker-health polling only for `system.view_health` users; the API still rejects unauthorized direct requests. The Results filter form remounts when its URL state changes, keeping Base UI's uncontrolled defaults stable. The manual guide now covers the M6 Results and review flows.

## What worked in the browser

| Area                    | Checks observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                    | Signed-out deep link redirected to Login; valid Admin/Manager sign-in worked; wrong password stayed signed out; invalid email, short name, weak password, and password mismatch were rejected; pending signup could not log in until Admin approval.                                                                                                                                                                                                                                                      |
| Users and roles         | Admin approved a signup, invited a user, created a custom 1-of-21-permissions role, assigned it to the Viewer, and restored Viewer. Restricted navigation and direct-route denial took effect immediately. The custom role could not be deleted while in use.                                                                                                                                                                                                                                             |
| Permissions             | Viewer could read job/results but not create/edit/review or open Admin/auto-filtered pages. Manager could access Blocklist and review results but not Users, Roles, Activities, or create a job.                                                                                                                                                                                                                                                                                                          |
| Activities              | Admin created and edited an activity. Invalid template placeholder and scoring total 99 were rejected. Unchanged save kept version 1; changing the per-domain cap advanced it to version 2.                                                                                                                                                                                                                                                                                                               |
| Blocklist               | Manager added, edited, and removed a domain. Duplicate add was rejected; a mixed valid/invalid batch added nothing; cancel preserved the row.                                                                                                                                                                                                                                                                                                                                                             |
| Jobs                    | Draft with only a name saved and explained missing start fields. Invalid domain, own-domain competitor, FTP URL, invalid name, negative/fractional/over-limit budgets were rejected. Start cancel retained Draft; start queued the job; later edit advanced settings version; stop recorded a reason; delete removed the disposable job.                                                                                                                                                                  |
| Results                 | Ready, Backlog, Auto-filtered, All, search, clear, and domain grouping worked. Detail showed score, sources, checks, evidence, normalized/original URL, and external links. Notes/metrics persisted; an HTML-looking note rendered as text. Claim, approve, use, reopen, reject, auto-next, keyboard claim, and bulk reject worked. A stale concurrent reject was refused without overwriting the other reviewer's decision. Viewer had no mutation controls.                                             |
| CSV                     | Label normalization, missing/invalid label, wrong extension, empty file, column preview/mapping, template reuse, worker validation counts, error CSV download, confirmation, competitor overlap, client-domain subtraction, zero-valid summary, and delete cancel/confirm were exercised. First competitor counts were 6 total / 3 valid / 2 invalid / 1 empty / 1 duplicate; second was 2/2/0/0; client was 1/1/0/0. The error CSV had expected rows 4–6 and reasons `not_http`, `bad_url`, `empty_row`. |
| Worker import           | With zero search budget and explicit competitor chips, the worker imported three distinct pages from confirmed CSVs. The public example URLs returned HTTP 404, so all three appeared in Auto-filtered with the failed page-load check and HTTP 404 in detail. This verifies plumbing, not real-site discovery quality.                                                                                                                                                                                   |
| Automated browser suite | `pnpm e2e` passed 20/20 against a production build, including authorization/API denial, CSV lifecycle, job lifecycle, activity, blocklist, role builder, mobile navigation, theme, and chip input interactions.                                                                                                                                                                                                                                                                                           |

## Coverage limits and environment notes

- Email invitation and password-reset **delivery/link completion were not verified**. Local web mail was configured for Gmail SMTP, while the local Mailpit inbox was empty. The invite UI's success message only proves request acceptance.
- Paid Serper discovery, real backlink relevance, robots/rate-limit behavior under load, 100 MiB uploads, default two-million-row cap, multi-page Results pagination, cross-browser behavior, and production deployment were outside this local browser pass.
- I did not trigger every job terminal/error state, because some require external failures or substantial worker inputs. The original 20-test E2E suite did not cover the audit findings; follow-up regressions now cover Draft edit data loss, live progress, CSV-only start readiness, and Storage cleanup.
- The first Results search produced a development-only Base UI warning. Its user-facing search result and clear action were correct in the tested paths.

## Recommended release gate

Keep the Draft edit, live-progress, CSV-only start, Storage cleanup, Reports navigation, and zero-usable-row CSV regressions in the release suite. Re-run the production browser suite before release.
