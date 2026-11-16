# M5-S3 check framework

Checks consume one `CheckContext` (the fetched response and the pinned job config
version/snapshot) and return `CheckResult(status, reason_code, detail, evidence)`.
Statuses are `pass`, `fail` and `could_not_check`; unknown is never coerced to fail.
Checks do not fetch pages or write to the database. The S4 built-in checks are
now available through the registry documented below; the S9 worker handler remains
separate work.

## Adding a check

Implement one class with `async run(context)`, then add one `CheckDefinition` to
the registry's catalog. That entry declares its order, reason templates and
terminal statuses. No executor changes are required. For example:

```python
from worker.checks import CheckContext, CheckDefinition, CheckRegistry, CheckResult, Reason

class ExampleCheck:
    async def run(self, context: CheckContext) -> CheckResult:
        return CheckResult("pass", "example_match", evidence={"count": 3})

registry = CheckRegistry([
    CheckDefinition(
        key="example",
        check=ExampleCheck(),
        order=10,
        reasons={"example_match": Reason("pass", "Matched {count} terms.", priority=20)},
    ),
])
```

Execution sorts by `(order, check_key)`. The page-load entry should come first and
set `stop_on=frozenset({"fail", "could_not_check"})` when downstream checks need a
readable page. A dead-page result then ends the run. Unexecuted checks have no
rows; they are not presented as passing or as measured failures. Each run records
`stopped_after` in memory for the future orchestrator.

`catalog.py` supplies the initial page-load and crawl-permission reason vocabulary.
S4 selects those reasons and adds any missing check-specific reasons; it owns
classification policy. Reason codes are unique within a registry, stable storage
identifiers, and must not be repurposed. Templates support simple evidence fields
such as `{count}` only. A missing field or undeclared/status-mismatched reason is
a programming error. Exceptions and cancellation propagate, not quality verdicts.

`registry.top_reasons(run)` returns up to three readable explanations, sorted by
descending catalog priority and then execution order. Priority is explanatory
importance, not a scoring weight; S7 owns numeric score contributions.

## Evidence and persistence

Evidence must be a finite JSON object, at most 16 KiB; detail is at most 2,000
characters. NUL, non-string object keys and non-JSON objects are rejected. Store
compact observations, never page HTML. The registry accepts 1–64 checks.

`save_check_run(conn, claim, worker_id, run)` publishes the entire snapshot through
`worker_save_opportunity_checks` inside the caller's transaction. The RPC locks the
opportunity and verifies `running`, worker ID, attempt number, unexpired lease and
pinned config version before replacing rows. It rejects stale attempts even when
the same worker ID has reclaimed the opportunity. A stale claim raises
`LostCheckClaim`; discard its results. Database failures propagate normally.

The table holds the latest complete snapshot, not append-only history. Replacement
also removes obsolete downstream rows if a rerun stops early. Invalid batches
roll back atomically. S9 can save checks and update scoring/queue/claim state in the
same transaction. S3 deliberately does not mark an opportunity done: that would
allow the job to finish before scoring.

Authenticated readers require `results.view` and visibility of the parent
opportunity. Clients cannot write checks. Workers can read them and publish through
the fenced RPC, but cannot bypass it with direct table writes.

## Rollout and verification

Apply `20261026020000_m5_check_framework.sql` before using persistence. The migration
is additive and leaves existing opportunities untouched. A code rollback may keep
the table and RPC; no data deletion is required.

Run `pytest tests/unit/test_check_framework.py`,
`pytest tests/integration/test_check_store.py`, and
`supabase test db supabase/tests/database/091_check_framework.test.sql`.
Tests cover ordering, short-circuiting, extension with one class/catalog entry,
reason ranking, validation, cancellation, round-trip storage, replacement,
claim fencing, and rollback with later work.

Verification on 2026-10-26: all 671 worker tests and eight focused SQL assertions
pass, along with Ruff, strict mypy, web typecheck and generated-type formatting.
The migration is applied locally. Full pristine-database SQL verification remains
the separate gate described in `docs/pre-m5-readiness-review.md`.

## M5-S4 built-in registry

`from worker.checks.catalog import default_registry` supplies the nine concrete
checks. Construct `CheckContext` with the fetch, pinned config and:

- `robots_txt`: rules for the **final URL's origin**; empty string for confirmed
  absence, `None` for unknown. Never reuse another origin's rules after a redirect.
- `domain_facts`: fresh `DomainFacts` from the seven-day cache, or `None`.
- `activity_profiles`: tuple of validated `ActivityProfile` snapshots. Each has
  the existing profile shape (`key`, `version`, `enabled`, `page_type_signals`,
  `relevance_rule`). Job `activity_keys` limits which profiles participate.

The existing job fields (`language`, `country`, `regions`, `seed_keywords`,
`brand_variants`, `sub_niche`, `activity_keys`, `banned_categories`, and
`require_language_region_match`) feed `JobCheckConfig`. Optional `check_settings`
contains calibrated thresholds and lists, validated by `CheckSettings`; unknown
job fields are ignored. The job/profile snapshots must remain pinned to the run's
config version. S9 owns loading snapshots and final state updates.

See [ADR 0019](adr/0019-free-checks-policy.md) for exact classification policy,
defaults, dependency benchmark and known heuristic limits.

## M5-S6 filtering

`select_auto_filter(run, context.job.check_settings)` returns a readable exclusion
or `None`. `publish_checks_and_filter(conn, claim, worker_id, run, settings)` saves
raw checks and any exclusion atomically. It reuses S3's fencing and the caller's
transaction. A filter finishes the claim; `None` keeps it running for scoring.
S9 must use this path when composing checks, filtering and scoring. The original
`save_check_run` remains available for raw-check-only storage and existing callers.

See [ADR 0021](adr/0021-explicit-auto-filter-policy.md) for the explicit allowlist,
confidence safeguards and discovery-time blocklist handling. Review readers can
use `opportunities.filter_reason` and `filter_detail` directly; raw observations
remain in `opportunity_checks`. The review UI itself remains in M6.

## Release 3 prospect checks

Relevance check evidence now carries `algorithm_version: 2`. It chooses the best
configured keyword's concept coverage across title, headings, description and
body instead of dividing every page by every configured phrase. A lone concept
from a multiword keyword does not establish topic relevance. Regional signals
remain separate, with configured city matches included in the evidence.

The `linkability` check records an editorial placement-route score independently
of topical relevance. It currently supports resource pages with an external
editorial link list and guest-post pages with contribution guidance or a contact
route. A failed route check caps the activity-fit scoring contribution at zero;
unknown routes for other activity types retain legacy scoring. Score breakdowns
identify algorithm version 2 and show the route evidence. These heuristics need
human labels before any claim of improved precision. Existing stored checks are
not rerun by **Rescore**; it only recalculates from their saved evidence.

## M5-S7 scoring

`worker.scoring.engine.score(opportunity, checks, source_signals, config)` is pure
and shared by initial publication and rescoring. Read the pinned job history with
`scoring.config.from_job_snapshot`; count Google source rows separately from total
provenance. After S6 returns no filter, compute a score and call
`scoring.store.save_score` inside the check transaction. S8 still owns queue
assignment; S9 will wire the full handler. Neither helper completes the lease.

See [ADR 0022](adr/0022-deterministic-scoring-and-explicit-rescore.md) for formulas,
Unchecked rules, explanation ordering, version semantics and rescore lifecycle.
