# ADR 0016: Shared fetch dispatch limits and total deadlines

Date: 2026-10-25. Status: accepted. Resolves readiness review B4.

## Decision

Every page request attempt, including retries and redirect hops, acquires a
registered-domain slot. The retry backoff is additional to this minimum spacing.
Separate workers use `PostgresDomainRateLimiter` with their normal worker-role
connection pools. The database serializes grants by domain and uses its own clock;
waiting callers release their connections and recheck after sleeping. They do not
reserve future slots. Cancellation can waste a granted slot but cannot refund it.
Different domains remain independent. Deploy the same delay configuration to all
workers (default two seconds); changing it requires draining existing fetchers.
The interval is between dispatch grants, not a guarantee about remote packet
arrival times. Each worker shares one fetcher to enforce its concurrency cap.

`PoliteFetcher(..., pool=pool)` is the production construction path. It no longer
silently creates an in-memory limiter. Explicit `rate_limiter=DomainRateLimiter(...)`
is supported for isolated tests/single-process tools only. Database failures
propagate to the caller, which must retry/defer as infrastructure failure; they
never authorize HTTP dispatch or become website quality evidence. There are no
production fetcher callers yet; M5 runner wiring must use the shared pool.

One asyncio deadline covers admission to the concurrency semaphore, preflight DNS,
rate-limit/DB waits, connection DNS and TLS, redirect hops, backoff and streaming.
It starts at `fetch()` entry and is not reset on retry or redirect (default 15s).
Expiry returns `timeout`, with the last target and completed redirect chain.
Cancellation from shutdown still propagates. Response contexts close on deadline
expiry. Synchronous decoding and event-loop scheduling are not hard real-time;
body size remains bounded by the existing cap. Phase-specific HTTP timeouts remain
as additional bounds. A congested domain may exhaust the budget before dispatch;
this is an unavailable check, never a negative quality verdict.

Robots retrieval is not implemented by this change. M5-S2 must reuse the same shared
limiter and deadline/SSRF protections for its bounded plain-text transport; it must
not use an independent local limiter or the HTML-only page response path.

## Migration and rollback

Apply `20261025030000_fetch_rate_limits.sql` before deploying these workers. It
adds a coordination-only table and a worker-only SECURITY DEFINER RPC. RLS is on;
API roles have neither table privileges nor RPC execution. Workers cannot directly
edit the table. Existing jobs, opportunities and domain facts are untouched.

Drain/stop old fetch-capable processes before starting the new workers: old local
limiters cannot participate in distributed coordination. Do not run mixed versions.
Rollback by stopping fetch activity and reverting the application; keep the new
additive schema in place. Resuming the old implementation with multiple workers
would reintroduce B4. No destructive down migration or live data deletion is needed.
Rows retain one timestamp per encountered domain; retention maintenance is deferred.

## Verification

Retry spacing (5xx and network timeout), stalled DNS and trickling streams failed
before the patch and pass afterward. Regression tests also cover redirect history,
rate-wait and backoff/admission budgets, shutdown cancellation, fail-closed
construction and coordination errors. Two independent real worker DB pools contend
for the same domain; grants remain spaced. A cancelled waiter leaves no future
reservation and other domains proceed. SQL tests verify permissions and validation.
Existing socket-boundary SSRF, Host/SNI and stream-cleanup regressions remain green.
