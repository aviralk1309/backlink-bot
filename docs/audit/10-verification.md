# Audit finding verification

## Executive summary

1. All six requested findings have local reproduction tests; S-01 also has an unrun direct-database probe.
2. **B-01 reproduced:** an invalid CSV URL beginning with `=HYPERLINK` survives in the generated error report as a formula (`apps/worker/tests/unit/test_audit_verification.py:22-49`).
3. **S-01 reproduced at the invite action:** a simulated `users.manage`-only actor can reach the service-role Admin assignment (`apps/web/src/features/users/s01-invite-action.test.ts:54-65`).
4. S-01's direct authenticated Postgres update remains **UNVERIFIED** at runtime because local Postgres is not running; a pgTAP TODO regression is ready (`supabase/tests/database/031_s01_role_assignment_ceiling.test.sql:1-34`).
5. **B-07 reproduced:** an unexpected fetch exception is converted to a website result instead of propagating (`apps/worker/tests/unit/test_audit_verification.py:52-62`).
6. **O-01 reproduced as configuration drift:** both example URLs use `postgres`; actual production credentials are **UNVERIFIED** (`.env.example:6`; `apps/worker/.env.example:1`).
7. **UX-04 reproduced:** a Storage deletion error still yields “File deleted” (`apps/web/src/features/csv/ux04-delete-action.test.ts:29-42`).
8. **I-04 reproduced as runbook drift:** manual SQL bypasses the retry-bounded reaper; the database effect was inferred from the two SQL paths, not executed (`docs/runbooks/worker.md:272-281`; `supabase/migrations/20261013164139_m3_job_engine.sql:187-216`).
9. Adjusted severity among these six: **2 BLOCKER, 3 HIGH, 1 MEDIUM, 0 LOW**. O-01 moves from HIGH to MEDIUM under the approved single-team, local-first boundary (`docs/audit/decisions.md:5-11,30-38`).
10. No production code, migration, runbook, or deployment setting was changed; tests are marked expected-fail/TODO and remain a future fix gate.

## Verification matrix

| ID | Reproduced? | Test path | Severity adjustment |
| --- | --- | --- | --- |
| B-01 | Yes, worker-generated error CSV contains an unescaped formula. The fallback HTTP report has the same unchecked `raw_url` interpolation but was not exercised (`apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:63-69`). | `apps/worker/tests/unit/test_audit_verification.py:22-49` | BLOCKER → BLOCKER |
| S-01 | Yes at the invite action: the role ceiling is absent before the service-role update (`apps/web/src/features/users/actions.ts:145-185`). Direct RLS promotion is **UNVERIFIED** at runtime; the pgTAP TODO test models a custom `users.manage`-only role. | `apps/web/src/features/users/s01-invite-action.test.ts:54-65`; `supabase/tests/database/031_s01_role_assignment_ceiling.test.sql:1-34` | BLOCKER → BLOCKER; invite path alone permits Admin creation |
| B-07 | Yes: an injected unexpected request exception does not propagate; `except Exception` returns `http_5xx` with no HTTP status (`apps/worker/src/worker/fetch/fetcher.py:503-511`). The downstream `page_unavailable` mapping follows from `apps/worker/src/worker/checks/core.py:27-48` and was not separately executed. | `apps/worker/tests/unit/test_audit_verification.py:52-62` | HIGH → HIGH |
| O-01 | Yes for both documented example URLs; no evidence that these credentials are used in production. The worker consumes `database_url` unchanged (`apps/worker/src/worker/main.py:45`). | `apps/worker/tests/unit/test_audit_verification.py:65-73` | HIGH → MEDIUM: local examples prove a least-privilege gap, not an exposed production deployment |
| UX-04 | Yes: mocked Storage returns an error after the delete RPC succeeds, and the action reports success (`apps/web/src/features/csv/actions.ts:292-298`). | `apps/web/src/features/csv/ux04-delete-action.test.ts:29-42` | HIGH → HIGH |
| I-04 | Yes for the dangerous instruction: runbook raw UPDATE increments attempts and always returns to pending, while the RPC marks exhausted rows failed (`docs/runbooks/worker.md:277-281`; `supabase/migrations/20261013164139_m3_job_engine.sql:195-212`). No manual DB recovery was performed. | `apps/worker/tests/unit/test_audit_verification.py:75-82` | HIGH → HIGH |

## Test evidence and limits

- `UV_CACHE_DIR=/tmp/backlink-uv-cache uv run --no-sync pytest -q tests/unit/test_audit_verification.py --runxfail`: **5 assertion failures**, one each for B-01, B-07, I-04 and two O-01 examples. The same file without `--runxfail` reports **5 xfailed**. Each `xfail` is strict so a fixed behavior becomes an unexpected pass.
- `pnpm exec vitest run src/features/users/s01-invite-action.test.ts src/features/csv/ux04-delete-action.test.ts --reporter=verbose`: **2 expected fails**. Vitest `it.fails` confirms the assertion fails while leaving the suite green.
- `pnpm exec tsc --noEmit`, focused Ruff check, and focused Prettier check: passed.
- `PGPASSWORD=postgres psql ... -f supabase/tests/database/031_s01_role_assignment_ceiling.test.sql`: **not executed**; the local service refused TCP on `127.0.0.1:54322`. The SQL is wrapped in `BEGIN`/`ROLLBACK` and `todo_start`/`todo_end` for later execution.

## Things I could not verify

- Direct PostgREST/SQL role promotion and self-promotion under a running database; run the S-01 pgTAP test after local Supabase is started.
- Whether a real operator used the O-01 example in any deployed environment, or ran the I-04 recovery SQL.
- Whether a user opened an affected B-01 error report in spreadsheet software; the export contains the executable formula syntax.

## Questions for the owner

- Is any worker environment outside local development configured with the `postgres` database role? That evidence would determine whether O-01 should return to HIGH.
- When local Supabase is available, should S-01's direct RLS and self-role tests be included in the next database gate? D3 already requires both (`docs/audit/decisions.md:19-28`).
