# ADR 0018: Origin-scoped robots policy and expiring domain facts

Status: accepted, 2026-10-26. Implements M5-S2; supersedes the robots portion of G14.

## Decision

Robots permissions belong to `(scheme, full IDNA hostname, effective port)`.
Preserve `www`, subdomains and non-default permitted ports. Registered-domain
normalization remains appropriate for gap grouping and shared rate limits only.

`origin_robots_cache` stores rules for up to 24 hours, separately from the existing
seven-day `domains` facts snapshot (TLD flags, contact/about observations).
Missing facts stay unknown. Detection of those facts belongs to the later checks;
S2 provides the cache API without adding extra contact/about requests.
Legacy domain-level robots and blocking fields remain for compatibility, but the
new fetch path never reads them. Do not migrate their values across origins.

The worker can only access robots through three restricted security-definer RPCs.
A row lock grants a 60-second refresh lease with a unique token. Other workers
wait without holding a connection. Expiry permits recovery after cancellation or
process death. Completion requires both the current token and an unexpired lease;
a stale response cannot authorize a page. Refresh itself is capped at 45 seconds
and also shares the enclosing page's total deadline (15 seconds by default).
Database failures propagate; they never become site-quality failures.

A successful bounded UTF-8 rules response is parsed using the existing Protego
dependency. Empty files permit crawling. A 404/410 means absent rules. Other HTTP
errors, network failures, unsafe redirects, HTML/challenge responses, or bodies
above 512 KiB suppress the page and cache an unavailable result for 15 minutes.
This accepts at least RFC 9309's required 500 KiB; oversized files are conservatively
unavailable rather than interpreted using incomplete rules. Rules may redirect
through five hops by default; every hop uses the existing SSRF transport and
shared registered-domain rate limiter. Retrieved rules apply to the initial origin.

Every page redirect checks its destination policy. A disallow returns
`could_not_check / robots_disallowed_for_bot`; unavailable rules return
`could_not_check / robots_unavailable`. An enclosing deadline returns `timeout`.
These are unknown check outcomes, not quality rejections. Googlebot rules do not
control our bot's crawl permission; indexability is a later check.

A detected page block or robots challenge/429 sets an origin cooldown, default
15 minutes, configurable through `RobotsPolicy.cooldown_seconds`. Retry-After
seconds or HTTP dates may extend this to one day. Subsequent pages return
`could_not_check / origin_blocked_cooldown`. Expiry permits a later request;
no permanent ban or cross-subdomain contamination is introduced.

Production construction is `PoliteFetcher(pool=pool)` and automatically enables
robots policy. Explicit rate-limiter injection is a low-level/test seam; callers
using it must also inject a robots policy before fetching pages. Raw robots
retrieval remains private and bypasses recursive robots checks only.

## Deployment and rollback

Apply `20261026010000_m5_origin_robots_cache.sql` before using the fetcher.
This migration adds a table and RPCs; no existing values or grants are removed.
The full check runner remains scheduled for M5-S9. Roll back worker code if needed
and retain the additive table; do not enable an old page crawler without robots
protection. No destructive database rollback is needed.

## Evidence

Unit tests cover rule precedence, merged bot groups, wildcard/end anchors,
Unicode paths, status policy, origin identity, redirect SSRF, 500 KiB+ rules,
body limits, cooldowns, and cache failure propagation. Integration tests use two
independent worker pools to verify one refresh, expiry, stale-owner fencing,
origin separation, and domain-fact TTL/moderation preservation. pgTAP verifies
API-role denial, RPC-only worker access, TTL bounds, and lease ownership.

Reference: [RFC 9309 sections 2.2–2.5](https://www.rfc-editor.org/rfc/rfc9309.html).
The conservative treatment of non-404/410 4xx is an application policy permitted
by the RFC, not a claim that every 4xx is a robots disallow.
