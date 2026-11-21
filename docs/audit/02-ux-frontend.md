# UX and frontend audit — 2026-11-17

## Executive summary

1. Access is permission-based, not hard-coded to the three starter roles; Admin has all permissions, Manager reviews/uploads/reports, and Viewer reads jobs/results/reports (`supabase/migrations/20261008075439_m1_seed_permissions_roles.sql:31-68`).
2. Protected pages use a server guard and a custom forbidden page; navigation visibility is only a convenience (`apps/web/src/lib/auth/guard.ts:6-20`; `apps/web/src/lib/nav-access.ts:3-24`).
3. Server-rendered pages have Suspense skeletons and many list empty states, but no route error boundary or route-specific recovery screen (`apps/web/src/app/(app)/layout.tsx:25-29`; `rg --files apps/web/src/app | rg '/(error|global-error|not-found|loading)[.]tsx$'` returned no matches).
4. A running job shows counters and credit use on Overview, and Queries refreshes, but CSV processing and Results do not refresh themselves (`apps/web/src/features/jobs/live-stats.tsx:34-83`; `apps/web/src/features/jobs/queries-panel.tsx:65-80`; `apps/web/src/app/(app)/jobs/[id]/page.tsx:143-165`).
5. Polling is a reasonable current choice; the problem is incomplete coverage and no elapsed-time or throughput expectation, not the lack of Realtime (`docs/adr/0009-polling-counters.md:1-7`; `apps/web/src/features/jobs/stats.ts:3-16`).
6. The review loop has shortcuts, bulk decisions and cursor paging, but each new row needs a separate claim and next-item navigation stops at a 50-row boundary (`apps/web/src/features/results/review-actions.tsx:68-157`; `apps/web/src/features/results/results-panel.tsx:99-105,479-499`).
7. An individual CSV delete can falsely say “File deleted” after Storage removal fails (`apps/web/src/features/csv/actions.ts:261-299`).
8. Shared Base UI dialogs/sheets, semantic tables, native selects, focus rings and reduced-motion CSS are present; focus restoration, contrast and narrow-screen review usability have not been measured against WCAG 2.2 AA (`apps/web/src/components/ui/sheet.tsx:4-77`; `apps/web/src/app/globals.css:173-181`; `apps/web/e2e/ux-responsive.spec.ts:12-40`).
9. Server actions check permissions and validate inputs, though metadata and outreach use manual guards rather than Zod; no server secret is imported into a client component in the reviewed tree (`apps/web/src/features/results/actions.ts:83-201`; `apps/web/src/lib/env.server.ts:1-6`).
10. Findings: **BLOCKER 0 · HIGH 4 · MEDIUM 7 · LOW 0**. The largest user risks are stale long-running states, review throughput, a false delete-success message, and unhandled server-render failures.

## Route and role map

Roles below are the seeded defaults. A custom role can open a route if it holds the listed permission; `isAllowed` accepts any matching permission for compound requirements (`apps/web/src/lib/auth/permissions.ts:6-17`). An authenticated user without the required permission gets the custom No access page (`apps/web/src/lib/auth/guard.ts:14-20`; `apps/web/src/app/(app)/forbidden.tsx:8-20`).

| Route | Admin | Manager | Viewer | Actual gate and purpose |
| --- | --- | --- | --- | --- |
| `/login` | Public | Public | Public | Sign in (`apps/web/src/app/(auth)/login/page.tsx:1-54`). |
| `/signup` | Public | Public | Public | Request access (`apps/web/src/features/auth/forms.tsx:74-111`). |
| `/forgot-password` | Public | Public | Public | Request a reset link (`apps/web/src/features/auth/forms.tsx:115-130`). |
| `/set-password` | Link/session | Link/session | Link/session | Set password after auth confirmation (`apps/web/src/features/auth/actions.ts:126-151`). |
| `/` | Yes | Yes | Yes | Active-session dashboard; cards/actions vary by permission (`apps/web/src/app/(app)/page.tsx:40-89`). |
| `/jobs` | Yes | Yes | Yes | `jobs.view`; search, status and page in URL (`apps/web/src/app/(app)/jobs/page.tsx:77-99`). |
| `/jobs/new` | Yes | No | No | `jobs.create` (`apps/web/src/app/(app)/jobs/new/page.tsx:19-22`). |
| `/jobs/[id]` | Yes | Yes | Yes | `jobs.view`; Results requires `results.view`, Report `reports.view`; actions need their own permission (`apps/web/src/app/(app)/jobs/[id]/page.tsx:57-79,115-170`). Tabs are Overview, Queries, Results, Report, Settings, Data/Uploads and Activity (`apps/web/src/features/jobs/view.ts:38-56`). |
| `/jobs/[id]/edit` | Yes | No | No | `jobs.edit` and editable job state (`apps/web/src/app/(app)/jobs/[id]/edit/page.tsx:23-39`; `apps/web/src/features/jobs/rules.ts:25-32`). |
| `/reports` | Yes | Yes | Yes | `reports.view` (`apps/web/src/app/(app)/reports/page.tsx:20-27`). |
| `/admin` | Yes | Yes* | No | Redirects to first permitted section; Manager has `blocklist.manage` only among seeded admin grants (`apps/web/src/app/(app)/admin/page.tsx:7-14`; `apps/web/src/lib/admin-nav.ts:6-22`). |
| `/admin/users` | Yes | No | No | `users.manage` (`apps/web/src/app/(app)/admin/users/page.tsx:58-61`). |
| `/admin/roles`, `/admin/roles/new`, `/admin/roles/[id]` | Yes | No | No | `roles.manage` on list and form pages (`apps/web/src/app/(app)/admin/roles/page.tsx:31-37`; `apps/web/src/app/(app)/admin/roles/new/page.tsx:18-23`; `apps/web/src/app/(app)/admin/roles/[id]/page.tsx:26-35`). |
| `/admin/activities`, `/admin/activities/new`, `/admin/activities/[id]` | Yes | No | No | `activities.manage` on list and form pages (`apps/web/src/app/(app)/admin/activities/page.tsx:39-44`; `apps/web/src/app/(app)/admin/activities/new/page.tsx:15-20`; `apps/web/src/app/(app)/admin/activities/[id]/page.tsx:20-29`). |
| `/admin/blocklist` | Yes | Yes | No | `blocklist.manage` (`apps/web/src/app/(app)/admin/blocklist/page.tsx:38-47`). |

*Manager's `/admin` landing is the blocklist, not the Users screen. This follows permission order (`apps/web/src/lib/admin-nav.ts:6-22`; `supabase/migrations/20261008075439_m1_seed_permissions_roles.sql:47-62`).*

| Handler route | Access and state contract |
| --- | --- |
| `GET /api/health` | Public health response (`apps/web/src/app/api/health/route.ts:1-20`). |
| `GET /api/system/workers` | `system.view_health`; 401/403/503-style unavailable states are returned as JSON (`apps/web/src/app/api/system/workers/route.ts:1-27`). |
| `GET /jobs/[id]/stats` | Job ID checked, signed-in database/RLS result; no-store JSON, 404 when missing/hidden, 500 unavailable (`apps/web/src/app/(app)/jobs/[id]/stats/route.ts:5-34`). |
| `POST /api/jobs/[id]/results/export` | `jobs.view` + `results.view` + `results.export` (`apps/web/src/app/api/jobs/[id]/results/export/route.ts:20-31`). |
| `GET /api/jobs/[id]/uploads/[uploadId]/errors` | `csv.upload` and upload lookup (`apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:7-33`). |
| `GET /api/reports/export` | `reports.view` (`apps/web/src/app/api/reports/export/route.ts:1-15`). |
| `GET /auth/confirm` | Public token callback, redirects to the intended safe route or login with an error (`apps/web/src/app/auth/confirm/route.ts:1-28`). |
| `/auth/signout` | Session sign-out route, with a GET path for middleware deactivation (`apps/web/src/app/auth/signout/route.ts:1-20`). |

## Flow-state coverage

`✓` means an explicit usable state exists, `△` means a partial or generic state, `—` means absent or not relevant. These are code-supported states, not a claim that every state passed browser testing.

| Flow | Happy path | Empty | Loading | Error | Partial failure | Denied | Long-running |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Authentication | Sign in, request access, reset/set password ✓ (`apps/web/src/features/auth/forms.tsx:42-140`) | — | Pending submit ✓ (`apps/web/src/features/auth/forms.tsx:19-39`) | Inline form error ✓ (`apps/web/src/features/auth/forms.tsx:63,105,128`) | Mail delivery outcome △ (`apps/web/src/features/auth/actions.ts:47-126`) | Pending/deactivated gate ✓ (`apps/web/src/lib/auth/gate.ts:1-45`) | — |
| Job create/list/control | Draft/start/pause/resume/stop/delete ✓ (`apps/web/src/features/jobs/rules.ts:34-66`) | List empty state ✓ (`apps/web/src/app/(app)/jobs/page.tsx:178-190`) | Skeleton and button pending ✓ (`apps/web/src/app/(app)/jobs/page.tsx:52-56`; `apps/web/src/features/jobs/job-actions.tsx:131-143`) | Action notice ✓; query failure generic △ (`apps/web/src/features/jobs/job-actions.tsx:109-110`; `apps/web/src/features/jobs/queries.ts:47-50`) | Delete cleanup pending ✓ (`apps/web/src/features/jobs/actions.ts:241-269`) | Page/action guards ✓ (`apps/web/src/lib/auth/guard.ts:14-20`; `apps/web/src/features/jobs/actions.ts:158-163`) | Counters and controls △; no ETA or stage duration (`apps/web/src/features/jobs/live-stats.tsx:85-174`) |
| CSV import/map/gap | Upload, map, confirm and preview ✓ (`apps/web/e2e/csv-mapping.spec.ts:51-135`) | “No files yet” ✓ (`apps/web/src/features/csv/csv-uploads-panel.tsx:87-91`) | “Reading file” ✓ (`apps/web/src/features/csv/csv-uploads-panel.tsx:130-148`) | Failed badge/reason ✓ (`apps/web/src/features/csv/csv-uploads-panel.tsx:145-153`) | Invalid-row summary ✓; delete cleanup gap, UX-04 (`apps/web/src/features/csv/csv-summary-modal.tsx:172-244`) | Upload form hidden and server/RLS gate ✓ (`apps/web/src/features/csv/csv-uploads-panel.tsx:27-41`; `supabase/migrations/20261015024143_m4_csv_schema.sql:281-292`) | Processing status does not auto-refresh △ (`apps/web/src/app/(app)/jobs/[id]/page.tsx:158-164`) |
| Paid search/checks | Query plan, checks and retry ✓ (`apps/web/src/features/jobs/queries-panel.tsx:37-91`) | No/omitted queries △ (`apps/web/src/features/jobs/queries-panel.tsx:65-74`) | Queries refresh ✓ (`apps/web/src/features/jobs/queries-panel.tsx:65-80`) | Query failures/retry notices ✓ (`apps/web/src/features/jobs/queries-panel.tsx:82-91`) | Uncertain credits shown ✓ (`apps/web/src/features/jobs/live-stats.tsx:85-96`) | Retry requires `jobs.control` ✓ (`apps/web/src/app/(app)/jobs/[id]/page.tsx:136-141`) | Five-second polling, no duration estimate △ (`apps/web/src/features/jobs/stats.ts:3-16`) |
| Results/review | Filters, drawer, shortcuts, decisions, export ✓ (`apps/web/src/features/results/results-panel.tsx:112-142,269-325`; `apps/web/src/features/results/review-actions.tsx:68-157`) | Queue/filter empty state ✓ (`apps/web/src/features/results/results-panel.tsx:329-343`) | Page skeleton ✓ (`apps/web/src/app/(app)/jobs/[id]/page.tsx:49-53`) | Action errors ✓; data-load error generic △ (`apps/web/src/features/results/actions.ts:14-80`; `apps/web/src/features/results/queries.ts:240-258`) | Stale decision response ✓ (`apps/web/src/features/results/actions.ts:60-75`) | Tab/filtered permissions ✓ (`apps/web/src/app/(app)/jobs/[id]/page.tsx:74-76`; `apps/web/src/features/results/results-panel.tsx:88-92`) | New results/queue counts remain stale △ (`apps/web/src/app/(app)/jobs/[id]/page.tsx:125-153`) |
| Reports/export | Filter, tables, CSV ✓ (`apps/web/src/features/reports/report-panel.tsx:161-224,226-280`) | Empty chart/table copy ✓ (`apps/web/src/features/reports/charts.tsx:31-77`) | Page skeleton ✓ (`apps/web/src/app/(app)/reports/page.tsx:13-16`) | Invalid filters handled; data RPC failure generic △ (`apps/web/src/features/reports/report-panel.tsx:101-112`) | Four report RPCs fail together △ (`apps/web/src/features/reports/queries.ts:23-41`) | `reports.view` ✓ (`apps/web/src/app/(app)/reports/page.tsx:20-21`) | — |
| Admin users/roles/activities/blocklist | Forms and list actions ✓ (`apps/web/src/lib/admin-nav.ts:6-22`) | List empty states ✓ (`apps/web/src/app/(app)/admin/users/page.tsx:163-175`; `apps/web/src/app/(app)/admin/roles/page.tsx:64-74`) | Page skeleton/pending ✓ (`apps/web/src/app/(app)/admin/users/page.tsx:50-54`; `apps/web/src/features/users/invite-form.tsx:66-82`) | Form errors ✓ (`apps/web/src/features/users/actions.ts:141-173`) | Invite email failure gives a recovery step ✓ (`apps/web/src/features/users/actions.ts:196-213`) | Per-section guard ✓ (`apps/web/src/lib/admin-nav.ts:1-22`) | — |

## Engineering and accessibility assessment

- **Long-running jobs.** `LiveStats` skips hidden tabs, polls every five seconds, backs off to 15 seconds on failure, and refreshes the page when the job status changes (`apps/web/src/features/jobs/live-stats.tsx:34-83`; `apps/web/src/features/jobs/stats.ts:3-16`). Start, stop and saturated resume have confirmations; failed query retry is exposed, but a stopped/failed job cannot resume (`apps/web/src/features/jobs/job-actions.tsx:36-60,112-191`; `apps/web/src/features/jobs/rules.ts:34-42`). The UI reports counts, not elapsed/remaining time or a named current stage. ADR 0009's polling choice fits a small internal team; use a unified refresh path before considering Realtime (`docs/adr/0009-polling-counters.md:1-7`).
- **Destructive actions.** Job and role deletion, blocklist removal, and CSV deletion ask for confirmation; a stopped job and deleted job cannot be undone (`apps/web/src/features/jobs/job-actions.tsx:194-249`; `apps/web/src/features/roles/delete-role-button.tsx:12-73`; `apps/web/src/features/blocklist/row-actions.tsx:84-113`; `apps/web/src/features/csv/delete-upload-button.tsx:20-37`). Review decisions can be reopened, and job activity is shown from persisted events (`apps/web/src/features/results/review-actions.tsx:260-271`; `apps/web/src/features/jobs/queries.ts:101-135`). Individual CSV cleanup and administrative audit history still have gaps (UX-04, UX-11).
- **Accessibility.** Base UI supplies the dialog/sheet primitives, titles are present in reviewed usages, controls predominantly have labels, tables use `<table>`, `<thead>`, `<th>` and `<td>`, and the shared CSS reduces motion (`apps/web/src/components/ui/dialog.tsx:4-78,119-145`; `apps/web/src/components/ui/sheet.tsx:4-77`; `apps/web/src/features/results/result-detail-drawer.tsx:268-287`; `apps/web/src/components/ui/table.tsx:6-38,67-102`; `apps/web/src/app/globals.css:173-181`). Native selects retain platform keyboard behavior (`apps/web/src/components/ui/native-select.tsx:1-28`). The [WCAG 2.2 AA standard](https://www.w3.org/TR/WCAG22/) also requires visible focus, focus not obscured, adequate contrast, and minimum target size or spacing; code review alone cannot certify those pixels and interactions. [WAI's modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) expects focus to return to the invoker when it remains available.
- **Rendering and caching.** Pages and database queries are server-side; client components are used for forms, shell navigation, polling and charts. `getSession`/selected job queries use React `cache` for request deduplication, not a shared cross-user data cache; mutations generally call `revalidatePath` (`apps/web/src/lib/auth/session.ts:25-52`; `apps/web/src/features/jobs/queries.ts:76-85`; `apps/web/src/features/jobs/actions.ts:59-60`; `apps/web/src/features/results/actions.ts:76,136,200`). No optimistic review mutation is used; version checks and explicit stale messages favor correctness (`apps/web/src/features/results/actions.ts:60-75,130-137`).
- **Action inputs and secrets.** Most form actions call Zod `.safeParse`; review metadata and outreach manually validate type/length/status then call constrained RPCs. “All inputs Zod-validated” would be false, but the reviewed actions do validate on the server (`apps/web/src/features/jobs/actions.ts:69-80`; `apps/web/src/features/csv/actions.ts:88-95`; `apps/web/src/features/results/actions.ts:94-123,151-190`). `SUPABASE_SERVICE_ROLE_KEY` lives behind `server-only`; client code uses the public Supabase URL/anon key (`apps/web/src/lib/env.server.ts:1-6`; `apps/web/src/lib/supabase/admin.ts:1-16`; `apps/web/src/lib/supabase/client.ts:1-12`). I found no confirmed secret leak in source; a production bundle check would settle emitted assets.
- **Large sets and Core Web Vitals.** Results use 50-row cursor paging and URL-synced filters, so virtualization is unnecessary at that page size (`apps/web/src/features/results/results-panel.tsx:144-267,479-499`; `apps/web/src/features/results/queries.ts:235-291`). Jobs and blocklist use server paging. Users and report-job selectors stop at 500, and job status counts stop at 10,000, creating correctness caps (UX-08). Recharts is imported only by a client report-chart component, with accessible tabular equivalents, but its report chunk size and LCP/INP impact are **UNVERIFIED** without a production build and field/lab measurement (`apps/web/src/features/reports/charts.tsx:1-79`; `apps/web/src/features/reports/report-panel.tsx:224,302-323`).
- **Language and visual system.** The document is `lang="en"`, most copy is in English source literals, number/date formatting mixes fixed English and browser defaults, and the font loads only Latin (`apps/web/src/app/layout.tsx:7-15,33-47`; `apps/web/src/features/jobs/stats.ts:18-22`; `apps/web/src/features/csv/csv-summary-modal.tsx:156-215`). Theme tokens cover most shared UI, with scattered direct amber/emerald classes in feature code (`apps/web/src/app/globals.css:17-58`; `apps/web/src/features/reports/report-panel.tsx:133-136`; `apps/web/src/features/csv/csv-uploads-panel.tsx:141-144`). This is an English-only UI today; internationalization requirements are **UNVERIFIED**.

## Findings

### [UX-01] Live work disappears from view outside Overview and Queries
- Severity: HIGH
- Type: GAP
- Area: UX
- Evidence: `apps/web/src/app/(app)/jobs/[id]/page.tsx:125-165,248-254`; `apps/web/src/features/jobs/live-stats.tsx:34-83`; `apps/web/src/features/jobs/queries-panel.tsx:65-80`; `apps/web/src/features/csv/csv-uploads-panel.tsx:130-153`.
- Why it matters: CSV import may sit at “Reading file…” and Results may stay empty while the worker is adding candidates, with no automatic refresh or “last updated” cue on those tabs. Users can mistake a live job for a stuck or empty one and repeat work.
- Recommendation: Reuse one visibility-aware refresh/status hook for processing CSV and active Results/queue states; show last update and a manual refresh control. Keep polling unless measurements justify Realtime. Effort M.
- Confidence: High

### [UX-02] Claim-first review taxes every prospect and stops at a page boundary
- Severity: HIGH
- Type: IMPROVEMENT
- Area: UX
- Evidence: `apps/web/src/features/results/review-actions.tsx:85-112,210-247`; `apps/web/src/features/results/bulk-review-form.tsx:119-139`; `apps/web/src/features/results/results-panel.tsx:99-105,479-499`; `apps/web/e2e/results-review.spec.ts:81-139`.
- Why it matters: A new prospect must be claimed before approve/reject is available; bulk approve/reject only works after rows are In review. The `N` path ends at the current 50-row page. For the core daily task, extra round trips and manual page transitions make review slow and interrupt keyboard momentum.
- Recommendation: Measure median seconds and clicks per decision in a 50-item usability session. If the claim step has no user value, atomically claim-and-decide with the same version/ownership checks; carry next-item navigation across pages. Effort M.
- Confidence: High

### [UX-03] Review shortcuts also fire from focused links and buttons
- Severity: MEDIUM
- Type: RISK
- Area: UX
- Evidence: `apps/web/src/features/results/review-actions.tsx:68-80,85-132,144-157`.
- Why it matters: The global key handler exempts inputs, textareas, selects and editable text, but not anchors, buttons, summaries or other interactive controls. A single letter can trigger a decision while keyboard focus is on another control; the same handler runs inside the result sheet.
- Recommendation: Scope shortcuts to the active review region and ignore all interactive descendants unless focus is on the sheet container; add a keyboard test for each shortcut with focused links/buttons. Effort S.
- Confidence: High

### [UX-04] CSV deletion reports success when file cleanup fails
- Severity: HIGH
- Type: CONFLICT
- Area: Data
- Evidence: `apps/web/src/features/csv/actions.ts:261-299`; `apps/web/src/features/csv/delete-upload-button.tsx:20-37`.
- Why it matters: The database row is deleted first, then Storage `.remove()` is awaited without checking its error, and the UI says “File deleted.” A private uploaded CSV can remain stored with no visible retry route, creating retention exposure and misleading the operator.
- Recommendation: Check the Storage removal result and enqueue a durable cleanup target on failure, as job deletion already does; show “cleanup pending” until it succeeds. Effort M.
- Confidence: High

### [UX-05] Server data failures have no local recovery boundary
- Severity: HIGH
- Type: GAP
- Area: Frontend
- Evidence: `rg --files apps/web/src/app | rg '/(error|global-error|not-found|loading)[.]tsx$'` returned no matches; `apps/web/src/features/reports/queries.ts:23-41`; `apps/web/src/features/results/queries.ts:240-258`; `apps/web/src/features/jobs/queries.ts:42-50`.
- Why it matters: A transient database error throws out of server rendering; the report's four independent RPCs are all-or-nothing. Users lose the whole page and get no page-specific explanation or retry, even when other data is available.
- Recommendation: Add an App Router error boundary with a retry and support-safe message for protected pages; let independent report sections fail separately where partial data is still useful. Effort M.
- Confidence: High

### [UX-06] Dialog focus and WCAG 2.2 AA are not demonstrated
- Severity: MEDIUM
- Type: RISK
- Area: UX
- Evidence: `apps/web/src/features/results/result-detail-drawer.tsx:268-287,304-313`; `apps/web/src/features/results/review-actions.tsx:55-66`; `apps/web/src/components/ui/sheet.tsx:10-77`; `apps/web/e2e/ux-responsive.spec.ts:12-143`; `apps/web/e2e/results-review.spec.ts:81-139`.
- Why it matters: The URL-driven result sheet has no trigger element, and successful decisions navigate to another result while the sheet is open. Base UI supplies modal behavior, but no test proves initial focus, focus restoration, Escape behavior, or focus order through next-item navigation. Color contrast and 24px target spacing are also **UNVERIFIED**; this is a coverage gap, not a confirmed WCAG failure.
- Recommendation: Add one keyboard-only e2e path for result drawer and CSV dialogs, then test both themes at 200% zoom and reduced motion with axe/manual focus and contrast checks against [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Fix any observed failure. Effort M.
- Confidence: Medium

### [UX-07] Responsive test proves navigation, not the core mobile workflow
- Severity: MEDIUM
- Type: GAP
- Area: UX
- Evidence: `apps/web/e2e/ux-responsive.spec.ts:12-40,62-143`; `apps/web/src/features/results/results-panel.tsx:408-475,544-616`; `apps/web/src/components/ui/table.tsx:6-18`; `apps/web/src/features/results/result-detail-drawer.tsx:268-288`.
- Why it matters: The 375px test checks the hamburger and a job-form control. The Results table has ten columns in a horizontal scroll container; there is no mobile test for finding a row, understanding its score, opening the drawer, deciding, and moving next. Structural pressure for horizontal scanning is clear, but actual failure is **UNVERIFIED**.
- Recommendation: Test that full review task at 375px and 320px, including zoom and landscape. If it is slow, show a compact result card/list on narrow screens while preserving the existing table on desktop. Effort M.
- Confidence: Medium

### [UX-08] Silent list caps will hide people, jobs, and report choices at scale
- Severity: MEDIUM
- Type: RISK
- Area: Frontend
- Evidence: `apps/web/src/features/users/queries.ts:6-27`; `apps/web/src/features/reports/queries.ts:44-53`; `apps/web/src/features/jobs/queries.ts:57-74`; `apps/web/src/features/results/queries.ts:235-291`.
- Why it matters: Admin users and report-job options stop at 500 with no “more” notice, while job status counts only inspect 10,000 rows. These are incorrect once the limits are reached, even though the Results list itself has sensible cursor paging.
- Recommendation: Add server-side search/pagination for users and the job selector, and count statuses in SQL; surface truncation until that work ships. Effort M.
- Confidence: High

### [UX-09] E2e coverage avoids the failure and accessibility states that matter most
- Severity: MEDIUM
- Type: GAP
- Area: Process
- Evidence: `apps/web/e2e/results-review.spec.ts:75-139`; `apps/web/e2e/ux-responsive.spec.ts:12-143`; `apps/web/e2e/csv-mapping.spec.ts:51-135,270-279`; `apps/web/src/features/results/review-input.test.ts:14-47`; `apps/web/e2e/support/seed.ts:58-70`; `apps/web/playwright.config.ts:3-24`.
- Why it matters: The suite uses a real local database, seeded users, a controlled worker script, one worker and a production server, so the covered happy paths are relatively deterministic. Unit tests exercise review parsing, but e2e does not exercise bulk decisions, shortcut focus, polling failure/recovery, long CSV processing, outreach verification, or contrast/zoom. These are the states most likely to fail in daily use.
- Recommendation: Add a small number of stateful e2e cases with seeded rows and intercepted API failures for those paths; keep the single-worker/local guard. Effort M.
- Confidence: High

### [UX-10] English-only copy and ad hoc status colors constrain expansion
- Severity: MEDIUM
- Type: IMPROVEMENT
- Area: Frontend
- Evidence: `apps/web/src/app/layout.tsx:7-15,33-47`; `apps/web/src/features/jobs/stats.ts:18-22`; `apps/web/src/features/csv/csv-summary-modal.tsx:156-215`; `apps/web/src/app/globals.css:17-58`; `apps/web/src/features/reports/report-panel.tsx:133-136`; `apps/web/src/features/csv/csv-uploads-panel.tsx:141-144`.
- Why it matters: Fixed English text and Latin-only font make translation a cross-cutting rewrite if non-English operators are planned; mixed locale formatting can display dates/counts differently in the same flow. Direct amber/emerald classes bypass shared semantic tokens, increasing dark-theme and contrast review work. A multilingual roadmap is **UNVERIFIED**.
- Recommendation: Decide supported languages now. If English-only, document it; if not, add a locale boundary for new copy/formatting and replace feature-specific status colors with existing semantic tokens when those components are touched. Effort M.
- Confidence: High

### [UX-11] Role and blocklist deletion lack an app-level audit record
- Severity: MEDIUM
- Type: GAP
- Area: Process
- Evidence: `apps/web/src/features/roles/actions.ts:95-142`; `apps/web/src/features/blocklist/actions.ts:102-126`; `supabase/migrations/20261010181643_m2_jobs_schema.sql:189-205`; `rg -n 'role.*event|event.*role|blocklist.*event|event.*blocklist|audit_log|audit_event|role_history|blocklist_history' supabase/migrations apps/web/src` found no matching audit implementation.
- Why it matters: A confirmed role or global blocklist removal changes access or discovery for the whole team, but the reviewed app has no durable who/when/what record for those changes. A mistaken or malicious change is difficult to reconstruct after the row is gone; external database auditing is **UNVERIFIED**.
- Recommendation: Write append-only actor/action/before-value events for role permission changes and blocklist removals, then expose the record to admins. Effort M.
- Confidence: Medium

## Things I could not verify

- WCAG 2.2 AA conformance, actual contrast ratios, screen-reader announcements, focus restoration and target spacing need rendered keyboard/assistive-technology checks; static source is insufficient (`apps/web/e2e/ux-responsive.spec.ts:12-143`).
- Mobile review speed, horizontal scrolling pain, and job ETA expectations need a live usability pass with real-size results (`apps/web/src/features/results/results-panel.tsx:408-475`; `apps/web/src/features/jobs/live-stats.tsx:85-174`).
- Bundle bytes, hydration work, LCP, INP and CLS need a production build/profile; no performance budget or measurements were found in the reviewed app/tests (`apps/web/package.json:5-15`; `apps/web/src/features/reports/charts.tsx:1-79`).
- This was source inspection only. No e2e run or production-bundle scan was performed; emitted client assets and external deployment configuration are **UNVERIFIED** (`apps/web/src/lib/env.server.ts:1-6`).

## Questions for the owner

1. Is mobile review a supported daily workflow, or only mobile monitoring and navigation?
2. What is the acceptable median time per reviewed prospect, and is an explicit claim step required by the team workflow?
3. Should CSV processing and Results update automatically while a job runs, and what delay would users consider stale?
4. Is English the only supported interface language for the first release?
5. What browser, assistive-technology and Core Web Vitals targets are required before launch?
