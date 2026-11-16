# ADR 0023: Stable review queues and bounded release

Status: accepted, 2026-10-27. Implements M5-S8.

## Decision

A worker assigns a scored, claimed opportunity while holding a per-job lock. The
first `review_queue_size` rows assigned to Ready receive permanent `first_ready`
membership and monotonically increasing `first_ready_rank`. This records the G16
cohort independently of later releases. Existing Ready/Backlog membership is
preserved when the assignment RPC is retried. The RPC completes the check claim in
the same transaction as its queue assignment; expired, stale, duplicate, filtered,
or unscored claims cannot be published.

When capacity is full, new rows go to Backlog. An authorized release takes up to
25 rows by default, bounded by both requested batch size and available Ready
capacity. Ordering is verified tiers before Unchecked, then descending score,
descending competitor overlap, oldest discovery, and UUID. Unchecked rows remain
eligible but rank behind all verified tiers. Release never changes first-ready
membership/rank. Each successful release writes one audit event.

## Access and lifecycle

The release RPC requires both `jobs.view`, `results.view`, and `results.release_batch`; worker
queue assignment is available only to the worker role. Browser clients cannot
write queue membership or first-ready evidence directly. The job page shows queue
counts and a release control only to roles with both permissions. SQL is the final
authority and rechecks permissions, capacity, eligibility and job existence.

The Ready count currently occupies the configured window. M6's review status will
allow reviewed rows to stop occupying that window while preserving their queue
history. The S8 release RPC is the single operation M6 will use after review frees
capacity. No new high-scored row displaces an existing Ready member.

## Tradeoffs

Queue assignment serializes only briefly on a job row; scoring/fetching remains
outside that critical section. Release locks the job and chosen backlog rows until
commit. An operator can request up to 500, while the default remains G17's 25.
Queue group counts are exact filtered database counts, so hidden auto-filtered
results do not leak through the panel. Initial pipeline wiring remains S9.
