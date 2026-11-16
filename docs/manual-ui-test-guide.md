# Manual UI verification — M6 review build

Use this as a checklist: mark each case Pass / Fail / Blocked. Start with sections
1–5; then run the admin, permissions and edge cases. This is synthetic test data,
not a real SEO campaign or a claim about the example sites' content.

## 1. Start the app and worker

From the repository root, start local Supabase if it is not running:

```sh
make db-start
```

Do not reset the database for manual testing. A reset removes your local users
and jobs. Do not run browser/integration tests concurrently with your manual
session; they modify test accounts and queued work.

Web terminal:

```sh
cd apps/web
pnpm dev
```

Open http://localhost:3000. If Next chooses another port, use the URL it prints.
The automated browser suite's port 3100 is temporary, not the normal manual UI.

Worker terminal:

```sh
cd apps/worker
RUNNER_ENABLED=true uv run python -m worker
```

The worker needs these settings in `apps/worker/.env` (keep actual keys private):

```dotenv
DATABASE_URL=postgresql://worker:worker@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<your local Supabase service-role key>
CSV_MAX_ROWS=2000000
```

Use the key matching the local Supabase instance used by the web app. Merely
setting `NEXT_PUBLIC_SUPABASE_URL` in the web environment does not configure the
worker. The worker reads its own environment. Expected logs: `worker_started`,
then CSV processing messages after you save a mapping. Refresh the Uploads page
if its status has not updated; do not assume background polling exists.

Use your existing Admin. If the earlier E2E seed accounts still exist:

| Account | Email                   | Local-only password |
| ------- | ----------------------- | ------------------- |
| Admin   | `e2e-admin@example.com` | `E2e-Passw0rd!x1`   |
| Viewer  | `e2e-user@example.com`  | `E2e-Passw0rd!x1`   |

These credentials are fixtures, not automatically provisioned on every startup.
Use a separate browser profile/incognito window for the Viewer.

Current scope: login, user/role management, job configuration/control, activities,
blocklist, CSV validation/mapping/confirmation, gap preview, worker checks and
scoring, and the job Results tab with review decisions. Real-site results depend
on the target site's response. Paid Serper discovery and a standalone Reports
page are not part of this build.

## 2. Authentication and access

| Test             | Input / action                                                                             | Expected                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Signed out       | Open `/jobs`                                                                               | Redirect to login; no private data                                         |
| Valid login      | Existing Admin credentials                                                                 | Opens authenticated app; navigation works                                  |
| Invalid email    | `not-an-email`                                                                             | Validation prevents login                                                  |
| Missing password | Leave blank                                                                                | Required/validation feedback                                               |
| Wrong password   | Correct email, `WrongPassword123!`                                                         | Clear error; remains signed out                                            |
| Signup           | Name `QA Tester`; email `qa-manual-01@example.com`; password + confirmation `ManualQA123!` | Request-access flow; no automatic Admin access                             |
| Short name       | `Q`                                                                                        | Rejected                                                                   |
| Weak password    | `abc123`, `abcdefghijk`, `12345678901` separately                                          | Too short, missing digit, missing letter respectively                      |
| Mismatch         | Password `ManualQA123!`; confirmation `ManualQA124!`                                       | Mismatch error                                                             |
| Password reset   | Use an account you control in local testing                                                | Generic request response; email-dependent flow requires mail configuration |
| Refresh/logout   | Refresh while logged in, then sign out and revisit `/jobs`                                 | Session persists before logout; protected route redirects afterward        |

For reset/invite links, use the mailbox configured for this app. A success toast
alone does not prove delivery. The synthetic `example.com` addresses are not
inboxes you can receive mail at. Record email-dependent checks as Blocked if no
local mail capture is configured.

## 3. Create a valid job

Create `QA Manual — Seed Flow`. For chip/list fields, type an item and press Enter;
verify it becomes a chip. A value still sitting in the input may not be saved.

| Field                                    | Sample input                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Job name                                 | `QA Manual — Seed Flow`                                              |
| Client                                   | `Acme CRM QA`                                                        |
| Client domain                            | `acme-qa.example.com`                                                |
| Target URLs                              | `https://acme-qa.example.com/crm`                                    |
| Business type                            | `CRM software`                                                       |
| Sub-niche                                | `CRM for small businesses`                                           |
| Activities                               | Guest post (add Resource page if available/enabled)                  |
| Country / Language                       | India / English                                                      |
| Cities or regions                        | Pune; Mumbai — separate chips                                        |
| Seed keywords                            | `small business crm`; `sales automation` — separate chips            |
| Brand variants                           | `Acme CRM`; `Acme`                                                   |
| Competitor domains                       | Leave empty for this seed-only case                                  |
| Reference sites                          | Leave empty                                                          |
| Seed list URLs                           | `https://example.org/manual-seed`; `https://example.com/manual-seed` |
| Banned categories / Blocked domains      | Leave empty for baseline                                             |
| Serper credit budget / Scrape credit cap | `0` / `0`                                                            |
| Pages per query                          | `1`                                                                  |
| Saturation window / Minimum new domains  | `20` / `3`                                                           |
| Per-domain cap / Review queue size       | `10` / `50`                                                          |
| Optional local business                  | `Acme QA Office`; `12 Test Road, Pune`; `+91 98765 43210`            |

Keep the remaining switches at their defaults. Save, refresh, reopen settings and
verify every value. Start, read the confirmation, cancel once, then start again.
Expected: Draft → Queued → Running with the runner enabled, then a terminal status
when its imported work drains. Inspect Activity and Results; the example URLs may
fail a page check and appear in Auto-filtered. Zero credit budgets keep this
manual scenario independent of paid discovery.

## 4. Input-validation and job-control cases

Use a separate `QA Manual — Validation` job. Change one field at a time so the
first error does not hide another error. After each rejected save, refresh and
verify persisted data did not change. Browser-native constraints or disabled
submit buttons also count as validation; not every error is a server toast.

| Field / scenario       | Invalid input or action                                             | Expected                                                  |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Job name               | Blank or `A`                                                        | Cannot save; minimum 2 characters                         |
| Job-name length        | 101 characters                                                      | Prevented or rejected; maximum 100                        |
| Incomplete Draft       | Name only, then Save draft                                          | Allowed; start-readiness problems shown                   |
| Start incomplete Draft | Try Start                                                           | Cannot run; missing fields/source explained               |
| Client domain          | `not a domain`                                                      | Rejected                                                  |
| Own-domain competitor  | Put `acme-qa.example.com` in both client and competitor fields      | Rejected                                                  |
| Target/seed URL        | `ftp://example.org/file`                                            | Rejected; HTTP(S) expected                                |
| Domain normalization   | `https://www.Example.org/path` in a domain field                    | Normalized as a domain; inspect saved value               |
| Duplicate chips        | Add the same keyword/URL twice                                      | No duplicate persisted item                               |
| Chip interactions      | Enter, comma, multiline paste, remove ×, Backspace with empty input | Correct chips added/removed; no lost neighbors            |
| Integer field          | `1.5`                                                               | Rejected where whole numbers are required                 |
| Negative budget        | `-1`                                                                | Rejected                                                  |
| Budget boundary        | `0`, `1000000`, then `1000001`                                      | First two valid; final value rejected                     |
| Pages/query            | `0`, `1`, `10`, `11`                                                | Only 1–10 allowed                                         |
| Saturation window      | `0`, `1001`                                                         | Rejected; range 1–1000                                    |
| Minimum new domains    | `-1`, `1001`                                                        | Rejected; range 0–1000                                    |
| Per-domain cap         | `0`, `1001`                                                         | Rejected; range 1–1000                                    |
| Review queue           | `0`, `501`                                                          | Rejected; range 1–500                                     |
| Phone                  | `call-me-please`                                                    | Rejected                                                  |
| Concurrent edit        | Open same Draft settings in two tabs; save A, then stale B          | B must not silently overwrite A; reload/conflict feedback |
| Lifecycle              | Pause Running, resume Paused, stop, cancel deletion once            | Correct status/actions; no transition on cancel           |
| Persistence            | Reload job; inspect Activity tab                                    | Saved state and transition history remain consistent      |
| List                   | Search `QA Manual`; use status filters; clear filters               | Expected jobs visible; filters do not modify jobs         |
| Delete                 | Delete a disposable draft/stopped test job                          | Removed; unrelated jobs preserved                         |

Do not expect Completed, Saturated or every failure state to be triggerable from
UI clicks alone. Those depend on worker pipeline conditions, not buttons.

## 5. CSV lifecycle with exact expected results

Files are in `fixtures/manual-ui/`. Create a SECOND job named `QA Manual — CSV Flow`
using the same business/targeting fields as section 3. Leave **competitor-domain
chips, seed list URLs, reference sites, blocked domains and banned categories
empty**; budgets remain zero. Keep it Draft until all confirmations are complete.
The competitor labels on the uploads identify the sources. Once at least one
competitor CSV with usable rows is confirmed, the job should be Ready to start.
Client files do not satisfy source readiness. A CSV with no usable rows cannot be
confirmed and therefore cannot satisfy source readiness.

### A. First competitor

1. Open Uploads; choose competitor; label `rival-a.com`.
2. Choose `01-competitor-a.csv`, then Upload file.
3. Expect Needs mapping. Open Map columns; choose **Source URL** as the URL column.
4. Map Page Title and Anchor Text as text, Domain Rating as number.
5. Save a template named `QA Backlink Export`; save mapping.
6. Expect Waiting to be read → Processing → Ready to confirm. Refresh if needed.
7. Open Review summary and compare these counts:

| File                  | Total | Valid | Invalid | Empty | Duplicates |
| --------------------- | ----: | ----: | ------: | ----: | ---------: |
| `01-competitor-a.csv` |     6 |     3 |       2 |     1 |          1 |
| `02-competitor-b.csv` |     2 |     2 |       0 |     0 |          0 |
| `03-client.csv`       |     1 |     1 |       0 |     0 |          0 |

Duplicate rows are included in Valid, not an extra category:
`Total = Valid + Invalid + Empty`.
The tracking-query variant of `/guides/a` is the duplicate. The first report
contains `not_http`, `bad_url` and `empty_row` errors. Download the error report
and check its CSV columns and row numbers. Confirm the file; status becomes Confirmed.

### B. Second competitor and overlap

Upload `02-competitor-b.csv` with competitor label **`rival-b.com`**. Reuse the
saved template, check its URL-column selection, validate and confirm.

Before adding a client file, expect:

- Three gap domains: `example.com`, `example.net`, `example.org`.
- `example.com` has overlap **2**, from two distinct competitor labels.
- The other two domains each have overlap **1**.
- A missing-client-file warning. Missing client data means unknown, not proof
  that the client has no backlinks.

### C. Client subtraction

Choose **client** upload for `03-client.csv`; map Source URL, validate and confirm.
Its URL is a referring page linking to the client, not the client's target URL.

Expect gap preview to remove **all of `example.net`**, even though its client-row
path differs from the competitor-row path. Two gap domains remain: `example.com`
and `example.org`; overlap for `example.com` remains 2. Client coverage is partial,
not a complete backlink inventory.

Start the job only after inspecting this Draft preview. With no extra seed URLs,
the backend import should produce three distinct linking pages: `/guides/a`,
`/guides/b`, and `/write-for-us`. Inspect them in the job's Results tab after the
worker runs. Public example pages may return 404 and appear in Auto-filtered;
the backend browser test verifies the exact imported paths.

### D. Negative and alternate-format files

Use a separate Draft `QA Manual — CSV Edge Cases` so these files do not change the
main gap calculation.

| File / action                          | What to check                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `04-all-invalid.csv`                   | Total 2, invalid 2; report gives reasons; status says No usable rows and Confirm import is unavailable; correct and replace the file |
| `05-alternate-delimiter.tsv`           | Tab-delimited preview; one valid row                                                                                                 |
| `06-quoted-multiline.csv`              | One data record, not two; comma and newline stay inside cells                                                                        |
| `07-header-only.csv`                   | Zero data rows; no fabricated candidates; Confirm import is unavailable                                                              |
| `08-empty.csv`                         | Rejected as empty before validation                                                                                                  |
| `09-wrong-extension.json`              | Rejected; accepted extensions are CSV, TSV and TXT                                                                                   |
| Missing competitor label               | Competitor upload blocked with useful feedback                                                                                       |
| Invalid label `not a domain`           | Rejected                                                                                                                             |
| Label `https://www.Rival-A.com/blog`   | Normalizes to `rival-a.com`                                                                                                          |
| Save-as-template checked, blank name   | Rejected; ask for template name                                                                                                      |
| Wrong URL-column selection             | Preview helps detect it; correcting mapping yields correct validation                                                                |
| Discard / replace / delete a test file | Cancel leaves data unchanged; confirmed action affects only intended file; preview updates                                           |
| Two files with same competitor label   | Must not inflate overlap as if they were two different competitors                                                                   |
| File over 100 MiB                      | Rejected by upload limit; this is a separate check from row count                                                                    |

For a quick row-cap test, stop the worker, restart with
`CSV_MAX_ROWS=5 RUNNER_ENABLED=true uv run python -m worker`, then upload/map the
6-record competitor-A file in a fresh edge-case job. Expect Failed with
`csv_row_limit_exceeded:5`, not Ready or partial success. Restore the default by
restarting without this override afterward. Files already validated will not be
retroactively revalidated. This tests cap behavior without generating two million
rows; the default-cap load test is a separate performance exercise.

## 6. Results and review

Use only disposable results from your QA jobs. Open the job's Results tab after
the worker has processed its imports.

- Switch Ready, Backlog, Auto-filtered and All; check that each view matches its
  label. Viewer can read allowed results but cannot open Auto-filtered.
- Apply Search, Domain, Tier, Activity, Source, Review status and Flag filters.
  Check URL and field values after Apply and Clear; try Group by domain and Show
  rows. Changing filters must not produce a browser console warning.
- Open a result to inspect its original and normalized URL, sources, score,
  checks, evidence, notes and external metrics. Text entered in notes must render
  as text on reload.
- On an eligible Ready result, Claim it, then Approve or Reject with a reason.
  Mark an approved link Used only after treating it as live. Reopen a decision as
  Admin; Manager and Viewer must not get that action. Try a stale second tab and
  confirm its old decision cannot overwrite the new one.
- If there are multiple In review results, select rows and try bulk approve or
  reject. Check that Claim leaves the pending count unchanged and a decision
  lowers it. If Backlog has rows, release a batch and check pending rises by no
  more than the free slots. A Viewer sees counts without a release button.
- As Admin or Manager, export the current filter, then choose a review status
  across all queues and a smaller column set including External metrics. Confirm
  the CSV includes matching rows beyond the current page and an Activity export event.
  Test a disposable note beginning with `=1+1`; a spreadsheet must display it
  as text. A Viewer must not see Export CSV.

The example CSV URLs can all fail page checks and land in Auto-filtered. Mark
Ready/Backlog review steps Blocked when your QA job has no eligible rows; do not
change unrelated user data just to make those checks pass.

## 7. Users and roles

Use disposable QA accounts; keep your normal Admin intact.

- Users: approve a pending signup with Viewer role; verify sign-in and restricted
  access. Reject a second pending signup; verify it cannot enter the app.
- Invite: name `QA Reviewer`, a local test mailbox you control, Viewer role.
  Try malformed email, blank name and missing role separately. Check invitation
  delivery only when local mail is configured.
- Deactivate a disposable active user; verify it loses access, including an
  existing session after navigation/refresh. Reactivate and verify access returns.
- Create role `QA Jobs Reader`, description `Manual verification role`, with only
  the job-read permission. Assign it to a disposable user; inspect the actual
  checked permissions and test what that user can do.
- Role names: blank and one character rejected; maximum 50 characters. Try a
  duplicate role name and confirm useful feedback rather than duplicate ambiguity.
- Assigned-role deletion should be blocked; reassign the user before deletion.
- Admin's mandatory user/role-management permissions must remain protected.
- In the Viewer window, inspect jobs and directly visit `/admin/users`,
  `/admin/roles`, `/admin/activities`, `/admin/blocklist`. Expect No access and no
  admin data, not merely a hidden navigation link. Viewer must not create, edit,
  start, stop, delete or upload where write permission is absent.

UI checks cannot prove all backend authorization paths; automated RLS/API tests
remain necessary even if every forbidden button is hidden.

## 8. Activity configuration

Create a disposable activity rather than changing seeded Guest post defaults.

| Input                                                                                 | Value                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Key                                                                                   | `qa_guest_post`                            |
| Display name                                                                          | `QA Guest Post`                            |
| Per-domain cap                                                                        | `10`                                       |
| Search template                                                                       | `{keyword} "write for us"`                 |
| Template language / priority                                                          | English / `1`                              |
| URL pattern / title phrase                                                            | `write-for-us` / `write for us`            |
| Relevance field weights (title, headings, meta, body)                                 | `4, 3, 2, 1`                               |
| Minimum relevance                                                                     | `0.3`                                      |
| Five scoring weights (relevance, language/region, activity fit, overlap, multi-query) | `40, 15, 25, 10, 10`                       |
| Spam penalty                                                                          | `20` (separate from the five-weight total) |

Check template preview; save, reload, then save unchanged (version should not
increase). Make one real configuration change and verify version increments.
Test invalid template `{unknown} "write for us"`, unclosed `{keyword`, a template
with no placeholder, scoring total 99/101, relevance minimum -0.1/1.1, and all
relevance field weights zero. Each should be blocked with useful feedback.
Supported placeholders: keyword, niche, brand, country, city.
Disabling an activity used by a Draft should prevent starting that job until its
selection/configuration is corrected. This tests configuration, not scoring accuracy.

## 9. Blocklist and general usability

On Admin → Blocklist, add these one per line, reason `Manual QA only`:

```text
qa-block.example.com
qa-block.example.net
```

Check normalization, search, reason edit, duplicate-add feedback and removal.
Try a batch containing a valid domain and `not a domain`: it should reject the
batch rather than silently drop the invalid item. Leave these entries out of the
main CSV fixtures' domains. Remove your QA entries afterward.

Across all screens:

- At mobile width (~390 px), inspect hamburger navigation, dialogs, tables and
  buttons for clipping or inaccessible actions.
- Toggle light/dark theme; refresh and check readability/persistence.
- Use keyboard Tab/Shift+Tab/Enter/Escape; confirm labels, focus and modal closing.
- Double-click Save/Upload/Confirm once: expect one logical operation, with pending
  feedback. A failure must not show a misleading success toast.
- Refresh after writes, navigate back/forward, and use two tabs; displayed state
  should match saved state and user permissions.
- Temporarily go offline for a disposable form submission; expect error/recovery,
  not silent data loss. Reconnect before retrying.

## 10. Record failures and clean up

For each failure record: test case, account role, page URL, exact input/file name,
expected result, actual result, screenshot, and worker log timestamp if relevant.
Distinguish a failed assertion from Blocked (worker off, mail not configured, or
feature not implemented). Avoid including service-role keys or session tokens.

Delete only your `QA Manual` jobs, QA activity/roles/users and QA blocklist entries.
Restore the normal CSV row cap and any test settings. Keep a working Admin account.
