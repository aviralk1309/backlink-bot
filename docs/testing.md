# Testing

| What | Command | Needs | Touches data |
|---|---|---|---|
| Lint, types, unit tests (web and worker) | `make check` | nothing running | no |
| Unit tests only (worker) | `cd apps/worker && uv run pytest -m unit` | nothing running | no |
| Integration tests (worker) | `cd apps/worker && uv run pytest -m integration` | local Supabase with worker role | yes |
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

## Worker integration tests

Integration tests for MVP 3 and beyond require a running Supabase instance with
the worker role configured. They test:

- **Concurrency**: Multiple workers claiming and processing rows simultaneously
- **Lease management**: Lease extension, expiry, and reaping
- **Deduplication**: Race conditions when multiple workers discover the same URL
- **Job lifecycle**: State transitions, completion detection
- **Counters**: Transactional updates, consistency

Environment variables:
- `TEST_WORKER_DATABASE_URL`: Connection string for worker role (default: `postgresql://worker:worker@127.0.0.1:54322/postgres`)
- `TEST_ADMIN_DATABASE_URL`: Connection string for admin role (default: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`)

Run with:
```bash
# Start local Supabase first
make db-start

# Run all worker tests
cd apps/worker && uv run pytest

# Run only integration tests
cd apps/worker && uv run pytest -m integration

# Run with verbose output
cd apps/worker && uv run pytest -m integration -v
```

## URL normalization test vectors

The shared test vectors in `fixtures/url-normalization.json` must pass for both
Python (pytest) and TypeScript (vitest). Changes to normalization rules require
updating this file. The format:

```json
{
  "url_vectors": [
    {"input": "...", "normalized": "...", "host": "...", "registered_domain": "..."},
    {"input": "...", "error": "empty"}
  ],
  "domain_vectors": [
    {"input": "...", "domain": "..."}
  ]
}
```