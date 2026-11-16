# ADR 0019: Deterministic free checks and conservative uncertain evidence

Status: accepted, 2026-10-26. Scope: M5-S4, M5-D1 and M5-D3.

## Inputs and execution

`checks.catalog.default_registry()` registers the eight checks in the S4 order.
Each receives the captured fetch, pinned job config, final-origin robots text,
fresh domain facts and pinned activity profiles through `CheckContext`. A missing
robots snapshot is unknown; an empty string means confirmed absent/empty rules.
Checks do not retrieve robots, follow canonicals, probe contact pages, or query a
database. `CheckContext.page` parses the bounded HTML once and is reused.

Page extraction excludes script/style/template/noscript content, hidden elements,
aria-hidden elements and inline display:none/visibility:hidden. This is static
HTML evidence, not computed browser visibility. It respects base URLs for links,
compares registered domains for external links and ignores non-HTTP link targets.
Unicode normalization preserves combining marks (including Indic scripts).

## Outcome policy

- Page availability follows the M5-S4 default: 404/410, a final HTTP 5xx after
  fetcher retries, and DNS failure fail the page-load check. Timeouts, TLS errors,
  bot challenges, JS shells, unsafe targets, unsupported/oversized responses and
  other HTTP errors remain unknown. A transport error without an actual 5xx
  status is unknown. A failed/unknown page load stops downstream execution.
  These are raw observations; S6 still owns auto-filter policy, and no check
  implementation modifies queue state or deletes a result.
- Indexability interprets generic/Googlebot meta directives and scoped
  X-Robots-Tag directives, including `none`. Repeated header fields are retained
  separately by the fetcher to preserve bot scope. Googlebot rules are evaluated
  against the final URL, independently of our crawler's permission. Unknown
  Googlebot rules remain unknown unless an explicit noindex already proves failure.
  Canonical URLs are recorded as evidence, never fetched or merged here.
- Language requires at least 120 Unicode letters/marks. Detection examines up to
  20,000 visible characters, with confidence >=0.90 and top-two margin >=0.20.
  Contradictory declarations, sufficiently strong different languages in text
  halves, low confidence, unsupported targets and short text stay unknown.
  A confident mismatch fails. These are model scores, not calibrated guarantees.
- Region checks run only when `require_language_region_match` is enabled.
  ccTLD and HTML language-region tags are hints; known generic-use ccTLDs are
  excluded. Matching configured region names in content also supplies positive
  evidence. Contrary ccTLD and HTML region must agree to fail; conflicting/weak
  evidence remains unknown. Hreflang alternatives are recorded but do not assign
  another page's region to the current page. S6/S7 own combined language/region policy.
- Relevance uses unique configured seed phrases, brand variants and sub-niche.
  Each phrase contributes at most once per field, preventing repetition from
  inflating the score. Defaults weight title/headings/meta/body as 3/2/2/1, with
  minimum 0.20. Scoped profile rules override these values; the best matching
  profile's relevance score is recorded. Supported Snowball languages use stemming;
  others use exact normalized matching, with literal fallback for CJK phrases.
- Spam produces individually named warning codes for excessive external-link
  count/ratio, thin text, configured phrases, confirmed missing contact/about facts,
  and configured suffixes. Absence of a contact link on one page is not proof of
  absence across the domain. Whitespace-based thin-content checks are suppressed
  for CJK. Warnings are score inputs, not a standalone auto-filter policy.
- Activity fit considers only enabled profiles selected by the job. URL patterns
  are literal fragments, not regexes. It weights URL/title/headings/body/list
  structure as 3/3/2/1/2; ties are resolved by profile key. Evidence supplies the
  chosen `activity_key`, profile version and matched signals. S9 will copy the
  result to the opportunity alongside scoring; checks themselves stay pure.
- Banned categories use the job's selected labels and configured phrase mappings;
  an unrecognised category is matched as a literal phrase. Word boundaries avoid
  substring accidents. Matching is a keyword heuristic, not semantic classification.

## Calibration and library decision

Lingua 2.2.0 (low-accuracy mode, all 75 languages) is selected. Runtime is offline;
models ship in the dependency. Unsupported target languages return unknown rather
than being silently mapped to an unrelated language. Norwegian `no` maps to
Bokmal/Nynorsk. The library is cached once per process; cold model loading can take
several seconds, so S9 deployment may warm it before claiming work.

Fresh-process benchmark on this development Mac, ten original 120+ character
fixtures (en/fr/de/es/hi/bn/zh/ja/ar/ru), 100 warm classifications:

| Candidate | Correct | Cold total | Warm per text | Peak process RSS |
|---|---:|---:|---:|---:|
| Lingua 2.2.0, low mode | 10/10 | 4.90 s | 2.39 ms | 161.36 MiB |
| langid 1.1.6, normalized probabilities | 10/10 | 1.99 s | 0.38 ms | 188.22 MiB |

Both meet this small fixture gate. Lingua is selected for lower measured memory
and its confidence-ranking API; langid remains a benchmark-only dependency.
This sample does not prove general accuracy or establish a production memory
ceiling. Mixed, ambiguous, unsupported and short-text behavior is tested separately.
Reproduce each in a fresh process with:

```
uv run --with lingua-language-detector==2.2.0 --with langid==1.1.6 python scripts/benchmark_languages.py lingua
uv run --with lingua-language-detector==2.2.0 --with langid==1.1.6 python scripts/benchmark_languages.py langid
```

`check_settings` in the pinned config contains thresholds and editable phrase/TLD
lists. Initial spam defaults are deliberately small and are only warnings. Pilot
calibration of thresholds and multilingual lists remains necessary (M5-P2/PM1).
No score tiers, queue assignment or worker orchestration is introduced by S4.

References: [Lingua Python API](https://github.com/pemistahl/lingua-py),
[langid probability normalization](https://github.com/saffsd/langid.py), and
[Google robots directives](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).


## Verification

2026-10-26: all 752 worker tests pass, including S4-to-S3 persistence against real
PostgreSQL. Ruff lint/format and strict mypy pass. The required dependency audit
passes after updating the existing Brotli/certifi/filelock transitive dependencies;
the local unpublished `worker` project is excluded by pip-audit. No new database
migration or live check-runner wiring is part of S4.
