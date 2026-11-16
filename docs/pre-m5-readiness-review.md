# M0–M4 and M5-S1 readiness review

Date: 2026-10-25. Scope: current working tree, including existing uncommitted work.

**Current decision (updated 2026-10-26): B1–B6 are closed and M5-S2 is implemented under ADR 0018. M5-S3 through M5-S7 are implemented; proceed to M5-S8. Full runner wiring remains M5-S9.** The initial review held M5-S2 pending these issues. The evidence below clears that development gate, not production deployment or pilot calibration. Owner inputs listed below still apply.

## Resolution progress

- **B1 resolved (2026-10-25):** guarded socket transport, environment proxies disabled,
  original Host/TLS identity preserved. Ten socket-boundary regressions added;
  all six initial reproduction cases failed before the fix and pass afterward.
  Focused fetch/SSRF suite: 36 passing tests. See ADR 0007 for the implementation contract.
- **B2 resolved (2026-10-25):** pickup, gap and seed imports now commit together;
  disconnect/cancellation rolls back to Queued; unrecoverable import errors
  roll back both imports and mark the job Failed with a stored reason. Duplicate
  SQL-side gap import removed by a non-destructive function migration. All four
  initial integration reproductions failed before the fix; the expanded runner
  suite passes 11 tests, including actual connection termination and controls.
  Atomic transactions replace the proposed additional import-phase/lease table;
  see ADR 0014 for rationale and the control-wait tradeoff. Local migration applied.
  Final gate: 569 worker tests and 54 targeted SQL assertions passed, plus Ruff
  lint/format, strict mypy and diff whitespace checks.
- **B3 resolved (2026-10-25):** CSV claims now have ownership tokens, renewable
  leases and bounded attempts. The runner recovers abandoned uploads, fences
  stale writes, and commits staging/summary atomically; attempt-specific error
  files prevent report overwrites. The original stranded-Processing reproduction
  failed before the fix. All 8 CSV integration tests, 577 worker tests and 129
  targeted SQL assertions pass, along with lint/format, strict mypy and web
  TypeScript checks. Additive migration applied locally and DB types regenerated.
  See ADR 0015 for coordinated worker rollout and rollback; live Storage/browser
  verification is not claimed by these fixture-based recovery tests.
- **B4 resolved (2026-10-25):** each HTTP attempt acquires a domain slot;
  a single deadline covers admission, DNS, shared rate waits, redirects, backoff
  and response streaming. PostgreSQL coordinates dispatches across worker pools;
  implicit process-local fallback is rejected and DB failures block dispatch.
  Retry-spacing, stalled-DNS and trickle-stream regressions failed before the fix.
  All 588 worker tests, 10 new SQL assertions, lint/format, strict mypy and web
  TypeScript checks pass. Additive migration applied locally; types regenerated.
  See ADR 0016 for deployment/rollback and future robots integration requirements.
- **B5 resolved (2026-10-25):** exact duplicate tracking now uses a temporary
  SQLite index with a 2 MiB cache; error reports and Storage transfers stream via
  disk. `CSV_MAX_ROWS` defaults to 2,000,000 data records; an excess record fails
  visibly and rolls back all batches. Exact-limit, cross-batch duplicate, cleanup,
  rollback and transfer regressions pass. All 595 worker tests (552 unit + 43
  integration/unmarked), Ruff lint/format and strict mypy pass. See ADR 0017.
  Real PostgreSQL staging benchmarks below show stable process memory as row
  count increases fivefold; Storage used a local chunked fixture.
- **B6 verification gate cleared (2026-10-25):** fresh development-server
  reproduction passed all 20 original browser tests; the earlier hydration reload
  loop did not recur and its historical cause remains unproven. No authentication
  product code was changed for this issue. Playwright now owns a fresh production
  build/server on port 3100, refuses server reuse, and retains failure traces,
  screenshots and login diagnostics. The CSV lifecycle uses real local Storage
  and worker-role Python code for validation and atomic job import; it verifies
  duplicate/invalid counts, downloads the generated report, confirms in the UI
  and checks one resulting opportunity. All 20 production browser tests pass,
  alongside 714 web unit tests, production build, lint, TypeScript, formatting
  and worker-driver lint. Local test jobs and their Storage files are cleaned.
- **M5-S2 implemented (2026-10-26):** origin-scoped robots caching, shared
  refresh leases with stale-owner fencing, destination checks on redirects,
  bounded text retrieval, expiring block cooldowns, and separate seven-day facts.
  See [ADR 0018](adr/0018-origin-robots-cache.md). Migration applied locally;
  generated DB types and web typecheck pass. Focused database suite: 12 assertions
  pass; worker lint/format and strict mypy pass. Real PostgreSQL tests prove
  cross-worker refresh coordination, expiry/recovery and preserved moderation.
  The full SQL suite is not green on this populated development database:
  existing pristine-user/role assumptions and two M3 query-plan assertions fail.
  No database reset or user-data deletion was performed.
- All six prerequisites and the M5-S2 implementation are complete.

### B5 memory measurements

Fresh processes, 200-character URL path suffixes; input generation, real runner,
validation, duplicate index, report handling and PostgreSQL staging included.
Each run verified Ready and staged-row counts and removed its fixture job.

| Input | Rows | Peak process RSS | Processing time | Error report bytes |
|---|---:|---:|---:|---:|
| Unique valid URLs | 50,000 | 70.02 MiB | 5.94 s | 0 |
| Unique valid URLs | 250,000 | 71.28 MiB | 29.99 s | 0 |
| Invalid URLs | 50,000 | 63.38 MiB | 4.87 s | 12,027,813 |
| Invalid URLs | 250,000 | 63.45 MiB | 23.89 s | 60,527,814 |

These measurements establish bounded growth for these fixtures, not a fixed
memory ceiling for all record widths or a two-million-row throughput claim.
See `apps/worker/scripts/benchmark_csv_memory.py` and `docs/testing.md` to repeat.
Live local Storage/browser verification subsequently passed under B6 above.

## Initial audit verification (before fixes)

| Check | Result |
|---|---|
| Web ESLint, TypeScript, Prettier | Passed |
| Web Vitest | 714 tests passed, 36 files |
| Worker Ruff lint/format, strict mypy | Passed |
| Worker unit tests | 528 passed |
| Worker integration tests against local Supabase | 17 passed |
| Worker tests without unit/integration markers | 7 passed; the usual marker-based commands omit these |
| pgTAP against existing local Supabase, without reset | 741 assertions passed, 23 files; pristine-state assertions passed |
| Browser E2E | 2 passed, 5 failed at login hydration, 13 did not run (serial dependencies) |

Not established: clean-clone reproducibility, production build/deployment, current remote CI status, external hosting configuration, real export compatibility, calibrated ranking quality. Local SQL tests validate the installed schema; no fresh migration replay was performed. Browser test setup creates its documented local test accounts.

## Milestone assessment

| MVP | Assessment |
|---|---|
| M0 foundation | Tooling checks pass; local Supabase works. ADR 0011 explicitly defers always-on hosting. Remote CI, branch protection, production secrets and recovery remain launch gates. |
| M1 identity | Permission, RLS and lockout SQL tests pass. Browser login gate is failing, so do not sign off the user journey. Keep `roles.manage` admin-equivalent per ADR 0012. |
| M2 jobs/configuration | Lifecycle, configuration history and activity seed SQL tests pass. Keep existing defaults for guest post/resource page, manual review and versioned configuration. Browser workflow sign-off remains open. |
| M3 engine | Existing concurrency, deduplication, counters and lease tests pass. M4 introduces an import/completion gap not exercised by those tests. |
| M4 CSV gap | Gap arithmetic and SQL tests pass; synthetic parser fixtures pass. Crash recovery, bounded validation memory, row cap and genuine worker-to-browser lifecycle proof remain gaps. |
| M5-S1 fetcher | Existing mocked tests pass, but connection-level SSRF protection and request-limit guarantees are incomplete. Fix before reusing transport for robots. |

The check handler is intentionally unset in `apps/worker/src/worker/main.py`; full fetch/check/score wiring belongs to M5-S9. This is not reported as an M3 defect.

## Blocking findings and concrete resolutions

### B1 — High: validated DNS results are discarded before connecting

`apps/worker/src/worker/fetch/fetcher.py:148` discards the resolved addresses returned by `validate_target_url`. The HTTP client subsequently connects using the hostname at line 186, allowing a second resolution to differ. Static resolver tests plus mocked HTTP responses do not prove protection against DNS rebinding.

Resolution: bind the transport connection to validated public addresses while retaining the correct HTTP Host and TLS SNI/certificate validation; prohibit unvalidated proxy resolution. Apply the guard to redirects and retries. Add a transport-level regression test in which a later DNS answer is private and prove no private connection is attempted. No live exploit was attempted during this review.

### B2 — High: a seed job can complete before seed import, and import failure has no recovery

`apps/worker/src/worker/engine/runner.py:69` commits pickup before the separate import at line 83. SQL pickup imports CSV gap rows but not seeds. `job_work_pending` in `20261014052928_m3_job_runner.sql:36` only considers opportunity checks. Another runner can therefore complete a seed-only job before its first opportunity exists. A crash after pickup loses the Python import step; import exceptions are only logged at line 93.

Evidence: a rolled-back local database reproduction created a running job with a valid seed URL and no opportunities. `job_work_pending` returned `[]`; `worker_complete_drained_jobs` completed it. This represents the state between committed pickup and Python seed import.

Resolution: persist an import phase and claim/lease it, make it part of `job_work_pending`, and retry idempotently after crashes. Finish gap and seed import before allowing completion or later search. Store terminal import failure reasons. Add two-runner, crash-after-pickup, pause/stop and retry tests. Remove the redundant gap import from one of its two current execution paths.

### B3 — High: CSV claims can remain processing forever after a crash

`20261023010000_m4_csv_validation.sql:85` selects only `mapped` uploads and commits their transition to `processing`. The CSV schema has no lease/owner/attempt fields, and `CsvRunner` has no recovery path. Delete/discard explicitly refuse processing files. Killing the worker after claim can strand the upload and the draft workflow.

Resolution: add CSV claim ownership, expiry, bounded attempts and a reaper; fence completion against stale ownership. Retry staging idempotently. Prove worker termination and restart recovers without duplicate rows or incorrect counts.

### B4 — High: retry requests bypass politeness; “total timeout” is not a total deadline

`fetcher.py:170` acquires the domain limiter before entering the retry loop. Retries at lines 263 and 362 use only exponential backoff, starting at 0.5 seconds against the configured 2-second domain interval. Reproduction with a mocked 500 response: **3 HTTP attempts, 1 limiter acquisition**.

`httpx.Timeout` is passed per request; there is no enclosing deadline around DNS, response streaming and redirects. The code therefore does not enforce the specified 15-second total bound. The in-memory limiter also coordinates only one fetcher/process, not multiple workers.

Resolution: acquire a shared domain slot for every network request, including robots, retries and redirects. Define the deadline explicitly and enforce it around each bounded fetch operation, including streaming/DNS. For multiple workers, coordinate request slots in Postgres or enforce single-worker operation explicitly. Add retry spacing, slow-stream, stalled DNS and multi-worker tests.

### B5 — Medium: ingestion does not have bounded validation memory or a row cap

`apps/worker/src/worker/io/csv_validator.py:214` retains every distinct normalized URL in a set and line 218 accumulates the complete error report in `StringIO`. Both grow with input size. The 500,000-row test covers the reader, not this validator. No enforcement of the M4-D1 two-million-row default was found in the ingestion path.

Resolution: use disk/database-backed duplicate tracking and a temporary streamed error report; enforce a configurable row cap with a visible reason. Measure the complete validator/staging path with mostly unique and mostly invalid large inputs, not only the parser.

### B6 — Verification gate: browser login does not reach hydration

The authorization browser test times out after 45 seconds waiting for `form[data-hydrated="true"]` in `apps/web/e2e/support/login.ts:12`. Its trace reports repeated navigation to `/login`. This establishes a failing browser gate, not yet a root cause; it may be dev-server/browser behavior or application code. Do not classify it as a password failure without further evidence.

The full run finished with the same hydration failure in authorization, CSV mapping, jobs, role builder and responsive UX. Only signed-out redirection and health passed; 13 dependent tests did not run. Capture client console/network and dev-server reload causes next, then rerun these workflows after the root cause is fixed.

Separately, `apps/web/e2e/csv-mapping.spec.ts:164` simulates worker validation by inserting staging rows and setting `ready` using the admin client. That test cannot verify actual Storage download, parsing, staging or crash recovery. Add one real worker-backed upload-to-opportunities test after B2/B3.

## M5-S2 contract conflicts and engineering decisions

The following is the implementation direction chosen under the user's delegation, pending resolution of this review. It is not a claim that the code already implements it. Record the spec deviations in an ADR when implementing.

1. **Separate robots from registered-domain facts.** Gap grouping, overlap and caps remain keyed by registered domain. Robots must be keyed by origin (scheme, full hostname, effective port), preserving `www` and subdomains. Store an origin cache related to the domain record rather than one robots string shared across all subdomains. Never use deduplication's scheme/host rewriting as authority to fetch a different origin.
2. **Robots refresh within 24 hours; domain facts may retain seven days.** G14/M5-S2 currently conflate the two. RFC 9309 scopes retrieval to the service and recommends not using a cached copy for longer than 24 hours unless unreachable. See [RFC 9309 sections 2.3–2.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3).
3. **Preserve unknown outcomes.** Explicit bot disallow returns `could_not_check` / `robots_disallowed_for_bot`, with no page request. Robots server/network failure suppresses page fetch and yields a distinct unavailable-check reason. A 404/410 can represent absent rules; handle 429/challenges conservatively with backoff. No network failure becomes a quality rejection.
4. **One refresh across workers.** Use a database-backed refresh lease with expiry and stale-owner protection so many URLs do not trigger simultaneous robots fetches. Recheck target-origin rules before following a page redirect. Robots transport must accept bounded plain text rather than the HTML-only page fetch path, and must share SSRF and politeness protections.
5. **Blocking suspicion expires.** Use timestamped, configurable cooldowns with a later probe; never treat an old boolean as a permanent site ban. Keep evidence scoped to the observed host/origin where appropriate rather than poisoning unrelated subdomains. Contact/about/TLD facts remain separate from robots policy and page-level check evidence.
6. **Preserve the business invariants.** No paid provider additions; no automatic reviewer decisions; no silent opportunity deletion; unknown client links remain unknown; overlap counts distinct competitor domains; failed access remains separate from bad opportunity quality.
7. **Idempotent replay should not inflate duplicate counts.** Keep current SQL behavior: a genuinely new source for an existing opportunity increments the duplicate counter; replay of the same source does not. Correct M4-S7's wording that suggests reruns should increment it. This prevents crash retries from altering business metrics.

RFC 9309 also requires assuming disallow for unreachable robots and parsing at least 500 KiB when a parsing limit is imposed. Retain these distinctions in fixtures and implementation. These are crawl permissions, not an SEO quality verdict. [RFC 9309 sections 2.3.1.4–2.5](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.4).

## Product decisions and external inputs

Use existing defaults without another business approval round: free/existing infrastructure only, guest post/resource page v1 scope, seeded role permissions, domain-level gap with all linking pages retained, manual approval, and configuration-backed weights/caps. Defaults are provisional quality settings, not measured accuracy claims.

Inputs engineering cannot invent:

- **Before external crawling:** a real bot contact URL/email controlled by the owner. Current `bot_user_agent` uses `example.com`. `BacklinkBot` can remain the provisional public token for local tests.
- **Before M4 pilot sign-off:** original real Ahrefs, Semrush and GSC exports. `fixtures/csv/README.md` explicitly says all fixtures are synthetic. Preserve partial client coverage warnings.
- **Before ranking quality/pilot claims:** 100–200 owner-labelled URLs and the target niches/languages. Seed conservative activity patterns; do not call uncalibrated scores accurate. Avoid a universal blacklist that incorrectly treats legitimate client niches as spam.
- **Before M9 production:** existing always-on host/account, actual admin and launch users, deployment domain, backup/restore plan and secret configuration. ADR 0011 defers hosting; these do not block offline M5-S2 development.

## Next sequence

B1–B6 are closed with the evidence above. M5-S2 through M5-S8 are implemented; M5-S9 is next (see `check-framework.md` and ADRs 0019–0023). Keep check/scoring/queue expansion in its scheduled S-tasks. Browser and real local ingestion verification now pass; production hosting, owner contact details and pilot inputs remain separate launch requirements.


## Additional finding during manual QA preparation

2026-10-25: confirmed competitor CSVs alone do not satisfy `job_start_problems`.
The source predicate in `20261010182546_m2_job_lifecycle.sql` considers positive
credit budget, seed URLs and job competitor-domain chips only. A zero-budget,
CSV-only job is therefore blocked with `no_source` despite usable confirmed rows.
The earlier browser lifecycle used budget 50 and did not cover this combination.
This is a newly identified readiness gap, separate from the six closed findings;
no implementation fix is included in the manual-test-data task. The manual guide
uses competitor-domain chips as a documented workaround and includes the pure
CSV-only case for reproduction. Resolve this source-contract gap before claiming
complete CSV-only start support.
