# ADR 0024: Claim-fenced opportunity pipeline

Status: accepted, 2026-10-27. Implements M5-S9.

## Decision

The opportunity worker uses one shared `PoliteFetcher` and an `OpportunityHandler`
for every claimed row. The handler loads the immutable job configuration for the
claim's version, including the activity check profiles pinned into job history,
then fetches the page, runs the registered checks, saves bounded fetch evidence,
and handles redirect/canonical duplicates. A clear row publishes raw checks,
score, and queue assignment in one database transaction. Queue assignment owns
completion and lease release; the existing database triggers maintain job
counters.

Every publication step is fenced by opportunity ID, worker, attempt, config
version, and live lease. A lost claim rolls back the transaction. Auto-filtered
rows publish their raw checks and visible filter reason atomically, then finish
without a score or queue assignment. Fetch outcomes that checks classify as
uncertain remain inspectable and receive the scorer's Unchecked treatment.

## Failure and recovery

Expected site outcomes are check evidence, not worker exceptions. Infrastructure
or unexpected handler errors are logged per row and do not stop sibling tasks.
The claim remains recoverable: the lease reaper retries it until the configured
attempt limit, then sets `check_status=failed` and `check_reason=max_attempts_exceeded`.
The engine releases outstanding claims on shutdown. The shared fetcher is closed
after worker tasks drain.

## Tradeoffs

Fetching and check execution happen outside a database transaction; only the
claim-fenced publication sequence is transactional. This avoids holding row
locks during network work while ensuring users never see checks without the
corresponding score and initial queue membership. The local-Postgres fixture E2E
passes through the real claim and publication path. Synthetic precision@50 is
recorded for regression only; real production calibration still depends on the
product-owned M5-PM2 labels.
