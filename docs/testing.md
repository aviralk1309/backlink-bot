# Testing

| What | Command | Needs | Touches data |
|---|---|---|---|
| Lint, types, unit tests (web and worker) | `make check` | nothing running | no |
| SQL tests (RLS, guards, functions) | `make db-verify` | `make db-start` | **wipes the local database first** |
| End-to-end (browser) | `make e2e` | `make db-start`, `apps/web/.env.local` pointing at local Supabase | creates `e2e-*` users and roles |

## SQL tests need a pristine database

The pgTAP files assume the freshly migrated state: no users, three starter
roles, seeded grants. `001_pristine.test.sql` checks this and says so when it
fails. Use `make db-verify`, which resets and then tests. Bare `make db-test`
on a database you have been using fails for that reason, not because of a bug.

After `make db-verify` the local database has no users. Recreate your Admin:

    cd apps/web
    BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='...' \
      pnpm bootstrap:admin --confirm-url <NEXT_PUBLIC_SUPABASE_URL>

## End-to-end tests

- Run against local Supabase only. `e2e/support/env.ts` refuses any other host.
- `e2e/support/seed.ts` creates `e2e-admin@example.com` and
  `e2e-user@example.com` (Viewer) with a fixed local-only password, and
  removes leftover `e2e-role-*` roles. It does not touch your own account.
- First run: `pnpm exec playwright install chromium`.
- Specs run in order, one worker, because they share the database.

## Adding tests

- New table or policy: add pgTAP in `supabase/tests/database/` and update the
  counts in `001_pristine.test.sql` if the seed changes.
- New permission: update the catalog and role-mapping assertions in
  `010_identity.test.sql` and the grant count in `001_pristine.test.sql`.
- Pure rules: Vitest next to the code. Server actions and pages are covered by
  Playwright, not Vitest.