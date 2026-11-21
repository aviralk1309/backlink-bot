# Product and architecture decisions (authoritative for audit fixes)

Date: 2026-11-18. Owner-approved. Codex must follow these and stop to ask if a
fix needs a decision not listed here.

## D1. Product boundary: single internal team
- The product is one shared workspace for one trusted internal team.
- It is NOT multi-tenant SaaS. No org/tenant model, plans, or entitlements are
  built now. Global permissions (jobs.view, results.view) are acceptable.
- Onboarding any separate customer organization is out of scope until a new ADR
  adds tenant isolation (org-scoped RLS/RPCs plus cross-tenant tests).
- Resolves: P-08, A-03 (tenancy part). Add an ADR stating this boundary.

## D2. Ready queue: stable membership
- A row that enters Ready stays visible there until a reviewer acts on it.
- Remove the replacement branch that demotes an unclaimed New Ready row to
  Backlog (supabase/migrations/20261104020000_quality_ready_queue.sql) via a
  NEW forward migration. Never edit applied migrations.
- Keep first_ready_rank and the existing release-from-backlog behavior.
- Update the pgTAP test 114 to assert stability, and keep ADR 0023 as accurate.
- Resolves: O-03.

## D3. users.manage is NOT Admin-equivalent
- Enforce in Postgres (RLS and/or RPC), not only in the UI or server actions:
  - A user cannot assign a role whose permissions exceed their own
    (role-assignment ceiling). Admin role is assignable only by Admin or
    roles.manage holders.
  - A user cannot change their own role_id.
  - The service-role invite path must apply the same ceiling before writing.
- Tests must cover direct PostgREST calls, the invite action, and a custom
  role holding only users.manage.
- Amend ADR 0012 to state the new rule. Log role-assignment changes.
- Resolves: S-01.

## D4. Hosting: out of scope for now
- Do not design, track, or review deployment/hosting. The untracked
  deploy/production draft is ignored: do not commit, extend, or audit it.
- Findings I-01, O-07, I-06, I-08 and the hosting part of A-03 are DEFERRED,
  not resolved. Production remains NO-GO; this is a conscious deferral.
- Still in scope because they hold locally: D-04 (backup/restore thinking for
  local Supabase), D-03 (migration safety), I-02 (CI browser job), I-03/I-04.

## D4a. Paid search: off until fixed
- Serper search stays disabled (default) until B-04 (crash replay of a charged
  call), B-05 (durable backoff), and P-04 (account-level credit ceiling) are
  fixed and tested.
- Do not enable it in any fixture, e2e test, or runbook step.

## D5. CSV staging retention: purge after confirmed import
- After an upload is confirmed and its gap/seed import has committed, delete
  its csv_rows. Keep the Storage file and error report per existing rules.
- Purge must be atomic with, or safely retryable after, import completion.
- Gap preview and error download must still work or degrade with a clear
  message after purge. Fix docs/data-dictionary.md to match.
- Resolves: D-05.

## D6. Individual CSV deletion: immediate Storage removal
- After the authorized delete RPC succeeds, attempt immediate Storage removal
  with the server-only service-role client.
- Keep the durable cleanup queue as fallback only when immediate removal fails.
- Resolves: AR-02.

## D7. Removed Admin-promotion snippets: no history rewrite
- Keep the snippets removed from the active tree. Do not rewrite Git history.
- Resolves: the history question raised by O-08 in the batch A review.
