# Backlink prospect quality and crawler improvement plan

Status: implementation underway, 2026-10-31. This document tracks the staged rollout.

## Implementation progress

- Release 1: new Serper results reject Google navigation URLs before discovery; per-query raw, accepted, rejected, repeated, and new-domain counts are stored. The existing Yogaban wrappers were moved to Auto-filtered, with original URLs and previous state retained. Its historical new-domain yield was corrected from 22 to 21 while preserving the old per-query value for audit. A one-credit live query returned 10 results: 7 redirects excluded and 3 external pages saved and checked. Rejection diagnostics keep counts and reason codes, not raw excluded URLs, to avoid persisting opaque query parameters.
- Release 2: small query budgets now cover later seed keywords and rotate the first region across activities and templates. Page 2+ is created only after the previous page adds a new domain. The draft job form previews first-page allocation, credit budget, conditional depth, and omitted keywords, activities, or regions. Timed-out or unusable successful provider responses stop automatic retries and reserve the observed per-call credit cost against the budget; the UI distinguishes that uncertain amount from confirmed usage. Template ranking from human outcomes is held until a review sample exists.
- Release 3: the 24 surviving Yogaban pages and current check evidence are listed in `docs/yogaban-prospect-review-worksheet.md` for PM labeling. New checks score each keyword's topic concepts without diluting across unrelated seed phrases and record a separate editorial placement-route signal for resource and guest-post pages. A failed placement-route check removes the activity-fit score contribution; old stored checks and reviewer decisions are untouched. These are versioned heuristics, not calibrated predictions. Human labels, a second-niche sample, holdout evaluation, and a safe recheck path for historical pages remain pending.
- Releases 4 and 5: bounded site crawl and verified live-link reporting remain pending. The first job is still a prospect baseline, not evidence of backlinks delivered.

## Outcome and baseline

The product should find **more distinct, relevant sites that a person could realistically approach per paid search credit**. A prospect is not a backlink. A backlink counts as delivered only after a reviewer records the live source page and the system verifies a link to the client's target URL. The bot should not create links or send outreach automatically.

The first Yogaban pilot is the baseline: 10 Serper credits, 80 saved URLs, 22 domains, 55 `google.com/goto` redirect wrappers, 27 Ready rows (only 24 external sites), and 18 of 18 loaded pages failing the relevance check. All 10 searches were page 1; the second and third seed keywords were never reached. There are no human review decisions, so approval rate and real link yield are unknown. Preserve this job as a comparison case.

**Primary measures**

| Measure | Definition | Why it matters |
| --- | --- | --- |
| Qualified domains per credit | Distinct external domains manually approved after review / reported Serper credits | Paid discovery efficiency; use domains, not raw URLs. |
| Precision at 20 | Approved prospects among the first 20 reviewed results | Reviewer's time and ranking quality. |
| Verified live links | Distinct live linking pages confirmed by an HTTP check | Actual delivery, separate from approval or a manual `used` mark. |
| Cost per verified link | Search credits, optional paid checks, and recorded review/outreach effort / verified live links | End-to-end cost, once placements exist. |
| Crawl health | Robots denials, 429/5xx rates, fetch p95, bytes and requests per domain | Site respect and operating cost. |

Show `—` when the denominator is zero or the review sample is too small. Track counts by activity, keyword, query template, source, and country. A raw result count must never be presented as link yield.

## Release 1 — repair search-result quality (P0)

1. Add one admission rule in the search discovery path. Normalize first, then reject search-engine navigation/redirect wrappers such as `google.com/goto` before `record_discovery`. Do not decode opaque `CAES...` parameters or fetch the wrapper to guess a destination. Preserve a compact rejection reason and count per query for diagnosis. Do not persist new rejected URLs; their opaque query parameters may contain tracking data. Historical saved rows retain their original URL for audit.
2. Keep historical Yogaban rows for audit. Reclassify the 55 wrappers as invalid discovery results in a reversible migration or read-model change, and exclude them from Ready, quality metrics, and saturation yield. Do not erase reviewer decisions or rewrite source provenance.
3. Make query yield distinguish raw organic results, accepted external URLs, duplicates, rejected wrappers, and accepted unique domains. Saturation must use accepted unique domains, rather than any syntactically valid host.
4. Add regression fixtures from the real wrapper shape and ordinary external URLs. Test job and domain counters, duplicate provenance, replays, historical reclassification, and a provider response with no usable results.

**Gate:** zero known search-engine wrappers in Ready or new opportunities; the same 10-response fixture produces accurate valid-domain counts; the credit budget and existing job history remain intact. Run one controlled paid query only after the offline fixtures pass.

Code areas: `apps/worker/src/worker/engine/search.py`, `apps/worker/src/worker/providers/serper.py`, `apps/worker/src/worker/urls/normalize.py`, `supabase/migrations`, `apps/web/src/features/jobs/queries.ts`, and their existing unit/integration/SQL tests.

## Release 2 — spend each search credit better (P0)

1. Generate the first-page plan by interleaving **seed keyword, activity, location, and template** before taking the budget cap. The current template-first round robin iterates each template's first keyword first, so a small budget misses later keywords. For a 10-credit job with three keywords and two activities, the preview should show coverage of all three keywords and both activities when valid templates exist.
2. Keep page 2+ as conditional follow-up work. Only schedule depth for a query family that yielded new, valid external domains on page 1; stop a family when its marginal yield drops. Keep the existing reported-credit budget enforcement and lease recovery. Treat a timed-out provider call as uncertain spend until reconciled, not free.
3. Show a pre-run search preview in the job UI: planned keyword/activity distribution, page depth, maximum credits, and whether a seed keyword or geography is omitted by the cap. For Nepal and Bhutan, use separate country-specific jobs until there is evidence that one combined job improves yield; the current job schema has one country.
4. Use existing review reports to rank templates after enough human decisions. Start with a deterministic rule, such as approved unique domains per credit with a minimum sample and exploration slots for untested templates. Avoid a machine-learning model at this stage.

**Gate:** a 10-credit fixture covers all configured keywords/activities where possible; no second page is bought after a zero-yield first page; no budget overrun or duplicate query execution under concurrent workers. The dashboard reports valid-domain yield per template, not just raw result count.

Code areas: `apps/worker/src/worker/engine/queries.py`, `apps/worker/src/worker/engine/search.py`, query-plan/search SQL, `apps/web/src/features/jobs`, and existing query-plan/budget/saturation tests.

## Release 3 — improve prospect accuracy (P1)

1. Have a PM label the 24 external Ready results from Yogaban as relevant/linkable, relevant but no placement route, competitor, off topic, spam, already linked, or uncertain. Record any Ahrefs/Semrush traffic or authority evidence in the existing Results external-metrics fields, including the check date; do not equate those numbers with editorial suitability. Add a second small job in another niche before treating these labels as general. Keep the human labels separate from crawler predictions.
2. Replace the present all-phrases relevance fraction with evidence for **topic**, **geography**, and **placement intent**. Match shorter concepts and reasonable synonyms in title, headings, and body; retain the full phrase as a strong signal, not a requirement. A Pokhara yoga page should not fail solely because it omits the exact phrase `wellness retreat Pokhara`. A generic travel page should not pass just for mentioning Nepal once.
3. Score linkability separately from topical relevance. For a resource page, look for an editorial list of external resources and a plausible way to suggest one. For guest posts, look for current contribution guidelines or recent contributed articles. Treat another yoga retreat business as a possible competitor, not an automatic prospect. Keep noindex, spam, and uncertain fetch outcomes visible with explanations.
4. Tune weights on a labeled training set and check precision at 20 and missed good prospects on a separate holdout. Version the rule and score breakdown. Re-run changed checks before rescoring old pages; the existing `rescore` action only recalculates from stored check evidence. Never silently change an existing human decision.

**Gate:** no regression on the labeled holdout; target at least 60% manual approval in the top 20 **after a minimum of 20 decisions**, while explicitly measuring missed viable sites. The 60% threshold is a pilot target, not a promise or a reason to hide uncertain pages.

Code areas: `apps/worker/src/worker/checks/text.py`, `content.py`, `inputs.py`, activity profiles, scoring policy, score/version storage, Results explanations, and check/scoring fixtures.

## Release 4 — add a focused, polite site crawl (P1)

**Implementation status (2026-11-04):** Depth-one candidate discovery, same-site selection, trap rejection, provenance, result filtering/export, and atomic ceilings of two child pages per domain and 20 per job are implemented. Admission ends five minutes after job start. Existing fetch checks retain robots, SSRF, rate, body-size, timeout, and 429 handling. `SITE_CRAWL_ENABLED=false` remains the default and is intentionally off locally until a real bot contact URL is configured. The labeled pilot gain gate remains open because no human-approved placement-page sample exists yet.

Search should find candidate **domains**; a bounded crawl should find the best page within each promising domain. Reuse the existing `PoliteFetcher`, robots cache, per-domain rate limiter, SSRF checks, size/time caps, canonical merge, and check pipeline. This is a focused prospect crawler, not a general web index.

1. For each accepted domain, inspect the search landing page and a small number of same-site links whose text/path suggests `resources`, `partners`, `contribute`, `write for us`, `contact`, or topic relevance. Start with depth 1 and at most 3–5 HTML pages per domain. Add a hard per-job request/byte/time ceiling. Do not follow off-domain links as new crawl jobs automatically.
2. Avoid URL traps: query-heavy faceted pages, calendars, search result pages, logins, repeated canonical URLs, and duplicate content. Use the existing URL normalization and final-URL/canonical merge. Keep short crawl evidence and provenance; do not store full HTML.
3. Check robots permission at every final origin and respect server throttling. Add tests for `Retry-After`/429 behavior and stop or cool down a domain that repeatedly blocks the bot. The crawler's user agent must identify the service and provide a contact route. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) defines robots handling and caching; [Google's guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro) describes robots as crawl control, not proof that a page is indexed.
4. Reuse a recent, versioned page observation across jobs only when its freshness and permission rules are clear. Measure duplicated fetches before adding a persistent page cache.

**Gate:** every test crawl stays within robots permission and configured limits; no private-network URL is fetched even after redirects; the crawler finds at least one previously missed, human-approved placement page in a labeled pilot without increasing Serper spend. Stop this release if the measured gain is absent.

Code areas: `apps/worker/src/worker/fetch`, `apps/worker/src/worker/checks/page.py`, opportunity discovery/claims, schema for crawl provenance and limits, and integration tests with local HTTP fixtures.

## Release 5 — measure links delivered and tune from outcomes (P2)

**Implementation status (2026-11-04):** Approved results can store manual outreach state and placement details. A fenced worker check records live, missing, or unknown link outcomes, rel attributes, redirects, and timestamps. Reports and CSV exports show current verified links and search credits by client, activity, template, and exact search query. `LINK_VERIFICATION_ENABLED=false` remains the default and is off locally until a real bot contact is configured; no live Yogaban link has been submitted. Outcome-based query reordering remains inactive until at least 20 verified placements provide a meaningful sample; the empirical live-link gate remains open.

1. Keep human approval and outreach manual. Add minimal fields for outreach status, intended client target URL, live source-page URL, and placement date. Do not automate email or link placement.
2. When marked live, fetch the recorded source page politely and verify that an `<a href>` resolves to the intended client domain/URL. Record `follow`, `nofollow`, `sponsored`, or `ugc` attributes, final redirect, first seen, last checked, and failure reason. A failed or blocked verification becomes `unverified`, not deleted. A manual `used` status alone is not proof of a live link.
3. Report verified links and cost per verified link by template, keyword, activity, and client. Feed these outcomes back into query ordering only after a meaningful sample. Keep a small exploration share so one early winner does not hide other sources.

**Gate:** a test link is verified, a removed link becomes unverified on recheck, blocked pages remain unknown, and reports distinguish approved prospects from verified live links. Google treats links created mainly to manipulate ranking, including scaled guest posting and paid ranking links, as [link spam](https://developers.google.com/search/docs/essentials/spam-policies); the review process should favor editorial value and transparent sponsorship labels.

Code areas: review schema/actions, Results detail, report SQL/UI/export, worker verifier, and permissions/audit tests.

## Rollout order and stop rules

Ship Releases 1 and 2 before another full paid run. First collect human labels from the existing 24 external results; use those labels to calibrate Release 3. Add the focused crawl only after a small offline/local fixture proves it can find more viable placement pages. Release 5 is needed before claiming that the product delivers backlinks rather than prospects.

Each release should include a reversible migration where needed, existing-job compatibility, permission checks, and a small regression test at the affected boundary. Compare the same review rubric and similar niches before and after; record actual Serper credits and avoid promising a fixed number of links. Keep the current polite-fetch and security controls intact. Optimize database writes or concurrency only if measured latency/throughput points to a bottleneck.

**Not in this plan:** web-scale crawling, automatic outreach, purchased links, an LLM scoring dependency, and new paid SEO data providers. Reconsider any of these only with evidence that the simpler pipeline cannot meet the quality and cost targets.
