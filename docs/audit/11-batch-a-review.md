# Batch A review — `codex/audit-verification`

> Review snapshot through commit `91ac362`. The findings below describe that point in time; the later fixes are listed under **Resolved**.

## Executive summary

1. Reviewed the ten commits through `91ac362`; that batch addressed all nine named findings.
2. Verdicts: **5 good, 5 weak, 0 broken**. “Weak” means the fix works in the tested path but leaves a specified gap.
3. New finding count: **0 BLOCKER, 0 HIGH, 4 MEDIUM, 1 LOW**.
4. S-01's Postgres guard denied Admin assignment, assignment of an unheld Manager role, self role change, and direct profile insertion by a `users.manage`-only actor; the invite action checks the ceiling before Auth creation and writes the profile as the caller (`docs/audit/decisions.md:23-32`; `apps/web/src/features/users/actions.ts:155-195`).
5. The last-Admin checks still passed (`supabase/tests/database/010_identity.test.sql:179-194`; disposable `supabase test db`: 54 files, 1,213 tests passed).
6. B-01 neutralized `=`, `+`, `-`, `@`, tab, carriage return, and spaces before `=` in generated Python reports and the TypeScript fallback; each path failed the same probes when reverted (`apps/worker/src/worker/io/csv_validator.py:33-36`; `apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:64-68`).
7. At review time, O-01 accepted a real login with `CREATEROLE`; its query checked only `rolsuper` and `rolbypassrls` (`apps/worker/src/worker/db/pool.py:9-16`; AR-01).
8. At review time, UX-04's durable queue retried a failed removal and cleared after success, but the immediate browser removal lacked a Storage DELETE policy (`apps/web/src/features/csv/actions.ts:293-304`; `supabase/migrations/20261015025911_m4_csv_storage.sql:29-47`; AR-02).
9. Only two new migration files were added; none of the applied migrations changed. A disposable reset replayed all migrations and the full database gate passed (`git diff --name-status main..HEAD -- supabase/migrations`; disposable `supabase db reset` and `supabase test db`).
10. At review time, the earlier verification report described pre-fix vulnerabilities as current (`docs/audit/10-verification.md:5-14`; AR-05). Only this report was written during that audit.

## Commit and finding matrix

| Finding / commit | Verdict | Evidence | Follow-up |
| --- | --- | --- | --- |
| Pre-fix probes / `a4fd23e` | weak | The commit added expected-fail Python and Vitest probes and a pgTAP TODO (`git show a4fd23e`; `docs/audit/10-verification.md:18-34`). The Python B-01, B-07, O-01, I-04 and web S-01/UX-04 assertions later failed on reverted sources. It did not exercise the TypeScript fallback, and its pgTAP probe was not a release gate until `a07dcd2`. | AR-03; mark the historical report as pre-fix (AR-05). |
| B-01 / `02b6b3c` | weak | The worker prefixes dangerous cells at `apps/worker/src/worker/io/csv_validator.py:33-36,288-297`; the HTTP fallback uses `csvCell` at `apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:64-68`, whose regex covers whitespace and control prefixes (`apps/web/src/features/results/export.ts:122-129`). Seven generated-report and seven HTTP fallback edge probes passed; reverting each source made its probes fail. The committed worker test checks only `=HYPERLINK` (`apps/worker/tests/unit/test_audit_verification.py:23-47`); no committed fallback test exists. | AR-03. |
| B-07 / `3518219` | good | Removing `except Exception` from the fetch loop leaves expected network handling while an injected `RuntimeError` propagates (`apps/worker/src/worker/fetch/fetcher.py:490-510`; `apps/worker/tests/unit/test_audit_verification.py:50-61`). Reverting the fetcher made the test fail: “DID NOT RAISE RuntimeError.” | None. |
| O-02 / `df9bb8d` | good | `Makefile:9-14` puts only unit tests in `check` and integration in its own target, matching `docs/testing.md:5-7`. `make -n check` contains no integration command; reverting the Makefile restores `uv run pytest -m integration`. No automated assertion was added for this trivial command change. | None. |
| O-01 / `3032148` | weak | Both examples use the local `worker` login (`.env.example:6`; `apps/worker/.env.example:1`; `supabase/seed.sql:8`). Example URL tests failed when those two files were reverted. Startup tests failed to import the assertion when `pool.py` was reverted, but a disposable `CREATEROLE` login passed the current assertion (`apps/worker/src/worker/db/pool.py:9-16`; `apps/worker/tests/unit/test_audit_verification.py:74-94`). | AR-01. |
| I-04 / `53e5fce` | good | The runbook now names the bounded RPC and a job-scoped diagnostic query (`docs/runbooks/worker.md:273-292`); the RPC marks exhausted rows failed without incrementing attempts (`supabase/migrations/20261013164139_m3_job_engine.sql:187-216`). Reverting the runbook made `test_i04_stale_lease_runbook_uses_bounded_reaper` fail. | None. |
| O-08 / `a5483bb` | good | `git ls-tree -r --name-only HEAD -- supabase/snippets` returned no files; the parent commit listed the two direct Admin-promotion snippets (`git show a5483bb`). Deletion needs no runtime test. The personal email remains in Git history. | Decide separately whether history removal is required; no secret was identified in these snippets (`docs/audit/00-orientation.md:216-223`). |
| O-13 / `437cf08` | weak | The local Storage cap equals the UI and bucket 100 MiB limits (`supabase/config.toml:116-119`; `apps/web/src/features/csv/limits.ts:9`; `supabase/migrations/20261015025911_m4_csv_storage.sql:22-27`). The static config test passed and failed when the config was reverted to 50 MiB (`apps/web/src/features/csv/limits.test.ts:5-12`). It does not attempt an upload at the boundary requested by O-13 (`docs/audit/00-orientation.md:261-267`). | AR-04. |
| S-01 / `a07dcd2` | good | D3 says “Enforce in Postgres” and “service-role invite path must apply the same ceiling before writing” (`docs/audit/decisions.md:23-32`). The trigger blocks changed `role_id`, and `can_assign_role` compares permissions (`supabase/migrations/20261118010000_role_assignment_ceiling.sql:7-25,32-56`). Direct SQL and PostgREST tests denied Admin and self changes; direct SQL also denied an unheld Manager role and profile INSERT. Reverting the action failed both invite tests; dropping the guard in the disposable database produced five `not ok` pgTAP assertions. Last-Admin pgTAP tests 28–30 still passed (`supabase/tests/database/010_identity.test.sql:179-194`). | None for D3. Keep the PostgREST and invite tests in CI (`apps/worker/tests/integration/test_s01_postgrest_role_ceiling.py:106-123`; `.github/workflows/ci.yml:67-73`). |
| UX-04 / `91ac362` | weak | The delete trigger queues raw and error paths without a parent FK (`supabase/migrations/20261118020000_csv_storage_cleanup.sql:1-43`). On Storage failure the worker transaction preserves both rows; after retry it removes both, including after the upload row is gone (`apps/worker/tests/integration/test_storage_cleanup.py:76-117`). Twice deleting an already missing object through the local Storage API succeeded; `countPendingCsvCleanup` reaches zero and the Data tab notice then clears on reload (`apps/web/src/features/csv/queries.ts:40-48`; `apps/web/src/features/csv/csv-uploads-panel.tsx:42-44,81-86`). Reverting the action failed both action tests; reverting the worker failed the retry integration test; dropping the queue trigger produced three `not ok` pgTAP assertions. The immediate success mock is not a reachable browser path under current Storage RLS. | AR-02. |

The disposable `supabase db reset` applied both new migrations after the existing series and `supabase test db` passed 54 files / 1,213 tests. The focused worker suite passed 11 tests; focused Vitest passed 5. Reverted source and configuration files were restored in the isolated `/tmp` copy after each negative run. A bare `psql -f` exits 0 even when pgTAP prints `not ok`; the actual database gate is `supabase test db` (`Makefile:25-26`; `.github/workflows/ci.yml:48-49`).

## Findings at review time

### [AR-01] Worker startup accepts CREATEROLE
- Severity: MEDIUM
- Type: GAP
- Area: Security
- Evidence: `apps/worker/src/worker/db/pool.py:9-16` selects only `rolname, rolsuper, rolbypassrls`; `apps/worker/tests/unit/test_audit_verification.py:76-94` omits `CREATEROLE`. A disposable `audit_createrole LOGIN CREATEROLE` account passed `ensure_restricted_role` (command output: `CREATEROLE login PASSED startup assertion`).
- Why it matters: The assertion promises a restricted worker connection but accepts a role with database role-management power. A misconfigured worker can start under broader privileges than its table grants imply.
- Recommendation: S — reject `rolcreaterole` and add a negative startup test for it.
- Confidence: High

### [AR-02] Immediate CSV removal is unreachable under browser RLS
- Severity: MEDIUM
- Type: CONFLICT
- Area: Data
- Evidence: `apps/web/src/features/csv/actions.ts:293-304` calls Storage `.remove()` with the caller's client; `supabase/migrations/20261015025911_m4_csv_storage.sql:29-47` grants authenticated users INSERT and SELECT policies but no DELETE policy. Disposable `pg_policies` output for `csv_uploads_objects_%` contained only `INSERT|authenticated` and `SELECT|authenticated`. `apps/web/src/features/csv/ux04-delete-action.test.ts:55-65` mocks a successful immediate removal.
- Why it matters: A normal individual deletion enters “cleanup pending” even while Storage is healthy and cannot use the tested immediate-success path. File retention depends on the worker running with Storage credentials.
- Recommendation: S — after the authorized delete RPC, use the service-role Storage client for the immediate attempt, or remove the impossible immediate path and make queued deletion the explicit product behavior; test the chosen path with real local Storage RLS.
- Confidence: High

### [AR-03] The TypeScript CSV fallback has no committed regression test
- Severity: MEDIUM
- Type: GAP
- Area: Security
- Evidence: `apps/web/src/app/api/jobs/[id]/uploads/[uploadId]/errors/route.ts:64-68` uses `csvCell`; `apps/worker/tests/unit/test_audit_verification.py:23-47` tests only the Python report. A temporary HTTP fallback test passed seven formula/control prefixes and all seven failed after the route source was reverted (command output: `7 passed`; then `7 failed`). No route test was added by `git show 02b6b3c`.
- Why it matters: One of the two original injection paths can regress while the committed suite remains green.
- Recommendation: S — commit a small route test covering a leading formula and a tab or carriage-return prefix, including the CSV body round trip.
- Confidence: High

### [AR-04] CSV limit test stops at config text
- Severity: LOW
- Type: GAP
- Area: Data
- Evidence: `apps/web/src/features/csv/limits.test.ts:5-12` reads `supabase/config.toml` and compares numbers; `docs/audit/00-orientation.md:265-267` asks for one upload above and one below the effective limit. No Storage request is made by the test.
- Why it matters: A correct config number can still differ from the running Storage service's enforced limit after restart or configuration drift.
- Recommendation: S — add one local Storage boundary test at just below and just above 100 MiB in the integration gate.
- Confidence: High

### [AR-05] Verification report still states pre-fix behavior as current
- Severity: MEDIUM
- Type: DOC-DRIFT
- Area: Process
- Evidence: `docs/audit/10-verification.md:5-14,20-25` says B-01, S-01, B-07, O-01, UX-04 and I-04 remain reproduced and tests remain expected-fail/TODO. The current tests are passing assertions (`apps/worker/tests/unit/test_audit_verification.py:23-103`; `supabase/tests/database/031_s01_role_assignment_ceiling.test.sql:1-80`), and the full disposable database gate passed.
- Why it matters: A reader can treat the historical pre-fix snapshot as the branch's current status and make the wrong release or remediation decision.
- Recommendation: S — label `10-verification.md` as a pre-fix snapshot and link this review without rewriting its historical evidence.
- Confidence: High

## Resolved

| Finding | Commit | Resolution |
| --- | --- | --- |
| AR-01 | `d5b18fc` | Rejects `CREATEROLE`, `CREATEDB`, and `REPLICATION` along with superuser and `BYPASSRLS`; negative startup tests cover each. |
| AR-02 | `d0cb446` | D6's service-role removal runs after the authorized RPC; a local Storage test covers immediate success, forced failure with a pending queue, and worker retry. |
| AR-03 | `ef86263` | The committed route test round trips all seven requested prefixes; all seven fail with the route fix reverted. |
| AR-04 | `6184c7a` | A local Storage integration test accepts 100 MiB minus one byte and rejects 100 MiB plus one byte. |
| AR-05 | `3c1635c` | A pre-fix banner links `10-verification.md` to this review without changing its body. |

D6 and D7 were recorded first in `ec984d1`. The final gates passed: `pnpm test` (764 passed, 1 integration test skipped by default), `pytest` (936 passed, including the Storage integration tests), and `supabase test db` (1,213 passed).

## Things I could not verify

- Whether a spreadsheet application executes any exported cell after its leading apostrophe; the review verified CSV bytes and round trips, not application behavior.
- Production worker credentials or deployment behavior; hosting is out of scope under D4 (`docs/audit/decisions.md:35-43`).

## Questions for the owner

- None. D6 chooses immediate service-role removal with a queue fallback; D7 rules out a Git history rewrite (`docs/audit/decisions.md`).
