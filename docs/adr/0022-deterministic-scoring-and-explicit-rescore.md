# ADR 0022: Deterministic scoring and explicit rescore

Status: accepted, 2026-10-27. Implements M5-S7.

## Decision

Use one pure Python scorer for initial publication and explicit rescoring. Inputs
are an opportunity, version-matched raw checks, source counts, and a captured
scoring snapshot. Gap and search use identical formulas. No HTTP or live settings
reads occur in the scorer.

The five positive weights sum to 100. Defaults are relevance 35 (the largest),
language/region 10, activity fit 20, overlap 20, and multi-query 15. An activity's
saved overrides take precedence; existing administrator-selected weights remain
supported. Spam subtracts at most 30 by default. All values, including thresholds
and saturation constants, are configuration data, not embedded in the algorithm.

- Relevance and activity fit use their stored check score, clamped to 0–1.
- Language and region each receive half the combined match component when region
  checking is enabled; `region_disabled` gives language the whole component.
  Inconclusive or failed matches receive no match credit.
- Competitor overlap uses `n / (n + k)`, default `k=2`.
- Multi-query uses `n / (n + k)` where `n=max(distinct Google queries - 1, 0)`;
  default `k=2`. CSV/seed provenance and `found_by_count` do not inflate it.
  Initial scoring and explicit rescoring count distinct Google source IDs. A
  query that finds an already scored URL later does not change its stored score
  until an explicit rescore; automatic refresh of those scores remains open.
- Spam uses `min(distinct warning signals / cap, 1)`, default cap 3. A failed
  legacy spam check with no signal list counts as one warning.
- Round each contribution using Decimal HALF_UP to two places, sum the displayed
  contributions, then clamp to 0–100. High starts at 70, Medium at 40, Low below
  40. Missing/inconclusive essential checks (page, language, relevance), missing
  numeric relevance evidence, or domain-cap exclusion force Unchecked.

Breakdown is an object (preserving the existing database constraint), containing
`components` with `{component, raw, weight, points, reason_code}`, the pinned
check config version, algorithm version, scoring policy version, effective
weights, complete policy, activity/profile version, and three catalog reasons.
Unchecked reasons come first; remaining reasons rank by absolute contribution
with stable component-order ties. It is evidence for triage, not a probability.

## Configuration lifecycle

`scoring_policy.config` is operator-managed JSON, validated by the worker's
`ScoringConfig`. Change its version when changing policy. An invalid policy fails
an explicit request atomically; it never erases previous scores.
`current_scoring_snapshot()` captures that policy and activity profile weights
and versions. New `job_config_history` rows capture it under `snapshot.scoring`.
Existing immutable histories are untouched: `from_job_snapshot()` uses packaged
v1 defaults when that key is absent, never live settings. An explicitly present
but invalid snapshot fails validation. Initial pipeline wiring in S9 must use
this helper with the opportunity's pinned history row.

Changing profiles/policy does not update existing scores. `jobs.rescore` plus
`jobs.view` and explicit confirmation enqueue a durable request. The RPC captures
current settings, including historical activities still referenced by raw checks.
Repeat submissions reuse the pending request and its settings.

## Rescore transaction and scope

Rescoring is available for completed/stopped jobs with no running checks. This
avoids racing active fetch/check work; pause/resume behavior stays unchanged.
The worker locks a request and its job with SKIP LOCKED, then processes eligible
opportunities in UUID pages of 500 inside one transaction. Concurrent workers
cannot execute the same request. A crash/disconnect rolls back the entire
transaction; another worker can retry the still-pending request. Invalid data
rolls back all scores to a savepoint and records a failed request and audit event.

Only `score`, `tier`, and `score_breakdown` are written on opportunity rows; the
existing `updated_at` trigger and tier aggregate trigger still apply. Raw checks,
source provenance, check versions, leases, queue membership, flags, fetch evidence,
and review state are untouched. Done rows and domain-cap skipped rows are eligible;
auto-filtered rows, duplicates, pending/failed work are excluded. Filtered rows
never regain a score. Requests have completion counts and readable activity events.

The job page shows confirmation, pending status, and the latest outcome. Refresh
or inspect Activity to see asynchronous completion. Requests require the worker
process to be running. The rescore loop runs independently of the future S9
check handler. Initial score publication is fenced by owner, attempt, lease, and
check configuration; it stays inside the caller's transaction for S8/S9 stages.

## Tradeoffs and proof

An entire job commits atomically, so large jobs hold locks until completion;
pages bound memory, not transaction duration. Progress/cancellation and batch
commits would require a separate product decision. The operator policy has no
new settings UI; activity weights use the existing editor. Calibration against
labelled pages remains S10. Queue assignment remains S8, full fetch/check/score
orchestration remains S9.

Golden fixtures cover exact component points, tiers and reasons, source parity,
rounding, caps, spam and uncertainty. Integration tests exercise changed current
weights, captured versions, atomic rollback, unchanged raw/queue fields, competing
workers, claim fencing and outer rollback. SQL tests cover privileges, confirmation,
inactive users, idempotency and immutable history. Web action tests cover the
permission/confirmation boundary and the idle-job restriction.
