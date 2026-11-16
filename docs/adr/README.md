# Architecture Decision Records
| # | Title |
|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith (A1) |
| [0002](0002-postgres-queue.md) | Postgres as queue (A2) |
| [0003](0003-direct-pg-worker.md) | Worker uses direct Postgres (A3) |
| [0004](0004-permission-catalog.md) | Permission catalog (A4) |
| [0005](0005-config-versioning.md) | Job config versioning (A5) |
| [0006](0006-opportunity-state-machine.md) | Opportunity state machine (A6) |
| [0007](0007-fetcher-ssrf-guards.md) | Fetcher SSRF guards (A7) |
| [0008](0008-csv-in-worker.md) | CSV parsing in worker (A8) |
| [0009](0009-polling-counters.md) | Dashboard polls counters (A9) |
| [0010](0010-search-provider-interface.md) | SearchProvider interface (A10) |
| [0011](0011-local-first-hosting.md) | Local-first hosting and error tracking |
| [0012](0012-roles-manage-is-admin-equivalent.md) | roles.manage is admin-equivalent |
| [0013](0013-forbidden-page-status.md) | Forbidden page shows with status 200 (M1-S8) |
| [0014](0014-atomic-job-import.md) | Atomic job pickup, gap import and seed import |
| [0015](0015-csv-claim-recovery.md) | Recoverable CSV claims and stale-attempt fencing |
- [0016 — Shared fetch dispatch limits and total deadlines](0016-shared-fetch-budgets.md)
- [0017 — Bounded CSV validation memory and row limits](0017-bounded-csv-validation.md)

- [0018 — Origin-scoped robots cache and expiring domain facts](0018-origin-robots-cache.md)

- [0019 — Deterministic free checks and uncertain evidence](0019-free-checks-policy.md)

- [0020 — Persistent per-job domain check admission](0020-domain-check-admission.md)

- [0021 — Explicit auto-filter policy and atomic publication](0021-explicit-auto-filter-policy.md)

- [0022 — Deterministic scoring and explicit rescore](0022-deterministic-scoring-and-explicit-rescore.md)
- [0023 — Stable review queues and bounded release](0023-stable-review-queues-and-bounded-release.md)
- [0024 — Claim-fenced opportunity pipeline](0024-claim-fenced-opportunity-pipeline.md)
