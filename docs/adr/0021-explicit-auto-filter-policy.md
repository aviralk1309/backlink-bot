# ADR 0021: Explicit auto-filter policy and atomic publication

Status: accepted, 2026-10-27. Implements M5-S6.

## Decision

`checks.auto_filter.select_auto_filter` is a pure policy over an immutable run of
raw checks. It returns a `FilterDecision` (check key, stable reason code, readable
detail) or `None`, which means continue to scoring/review, not that every check
passed. Unknown/new reason codes are never implicitly filtered.

Filter precedence is page availability, indexability, language, then banned
category. Execution order does not affect this choice. All raw results remain
stored, including secondary failures. Duplicate check keys are rejected.

| Check | Explicit failure reasons that filter |
|---|---|
| page_loads | page_not_found, page_gone, persistent_server_error, dns_failure |
| indexable | meta_noindex, header_noindex, googlebot_disallowed |
| language | language_mismatch, with the confidence checks below |
| banned_category | banned_category_match |

The page-load policy follows the S4 default; transport failure without an actual
5xx status does not become `persistent_server_error`. A reason must belong to the
correct check and have status `fail`. A matching code attached to pass or unknown
never filters.

Language requires finite numeric confidence >=0.90 and margin >=0.20, or stricter
thresholds from the pinned job settings. Lowering detection thresholds cannot
weaken these auto-filter floors. Evidence must include enough letters/marks for
the configured minimum, distinct nonempty target/detected languages, and no
contradictory declarations or detected segments. Missing, weak or inconsistent
evidence continues to review. This is a conservative model-based rule, not a
claim that language classification is infallible.

Spam warnings, low relevance, region mismatch, poor activity fit, timeouts, TLS
errors, bot challenges, our crawler's robots disallow and every could-not-check
outcome are outside the filter allowlist. A separate explicit failure may still
filter a row even when another check is unknown.

## Discovery-time rules

Global and job-specific blocklists and the skip-previously-spam setting already
run in `record_discovery`; keep that existing implementation and priority.
Previously-spam domains remain flagged and reviewable when skipping is disabled.
Do not re-read live blocklists/settings after a check run to silently reinterpret
an earlier discovery. Filtered discoveries are not claimed or fetched.

A new `opportunities.filter_detail` field stores readable text beside
`filter_reason`. A trigger populates explanations for discovery rules, clears the
text when a row leaves Auto-filtered, and handles legacy reason codes with a
readable fallback. The migration backfills existing filtered rows without changing
their reason, status, grouping, sources or identity. Every Auto-filtered row must
have a nonempty explanation, bounded to 2,000 characters.

## Atomic persistence

`publish_checks_and_filter(conn, claim, worker_id, run, settings)` selects the
policy and calls a worker-only publication RPC. It reuses S3's snapshot serializer
and `worker_save_opportunity_checks` to lock the opportunity and fence worker ID,
attempt, active lease and pinned config version. The database verifies that a
filter decision references a failed check from the same publication. The Python
policy owns the allowlist; the RPC is not a browser-facing decision API.

For a selected filter, raw checks and these updates commit together:

- queue_group = auto_filtered; filter_reason/detail identify the exclusion;
- check_status = done, with lease/owner cleared;
- score, score_breakdown and tier are cleared (there is no score for an exclusion).

No opportunity or source row is deleted. Raw check replacement remains the S3
latest-complete-snapshot contract. Existing counter triggers exclude filtered
outcomes from Unchecked counts. The caller can roll back the entire publication
with later transaction work. A stale handler cannot publish or replay completion.

For `None`, raw checks are saved and the claim stays running; queue and score
fields remain unchanged for S7/S8/S9. The helper does not prematurely finish a row
that still needs scoring. S9 must branch on the returned decision: filtered rows
are complete; continuing rows need scoring and queue assignment in the same
caller-owned transaction.

## Rollout and rollback

Apply `20261027010000_m5_auto_filter.sql` before using this helper. The existing
S3 RPC remains signature-compatible. This change adds no live handler wiring;
that remains M5-S9. Application rollback may retain the additive column, trigger
and RPC; do not delete filtered opportunities or erase their evidence.

## Verification

Unit tests cover every allowed rule, all three statuses, wrong-check/unknown codes,
excluded warnings, confidence boundaries, conflicting evidence and precedence.
Real S4 fixture results feed the policy. PostgreSQL tests cover atomic publication,
claim preservation, stale attempts, replay rejection, rollback, readable discovery
reasons, failed-check evidence validation, role access and retained rows.


Verification on 2026-10-27: 828 worker tests and 110 focused SQL assertions pass
(discovery rules, S6 publication, runner/counters and S3 persistence). Ruff lint,
formatting, strict mypy, web TypeScript checks and generated-type formatting pass.
The migration is applied locally. Full pristine-database SQL verification remains
a separate gate, as recorded in the readiness review.
