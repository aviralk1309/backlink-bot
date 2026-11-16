# Free-check fixtures

These are original synthetic pages, with no copied third-party website content.
`manifest.json` labels 15 focused S4 check examples. `calibration.csv` adds 25
pages for a 40-page offline evaluation set, including quality, spam, thin,
language, noindex, redirect-final, challenge, JavaScript-shell, large-response,
and non-HTML cases. Fetch outcomes and redirect metadata are represented in the
CSV so the real checks and scorer run without network access.
`languages.json` contains the original multilingual passages also used by
`scripts/benchmark_languages.py`.

`test_free_checks.py` runs the labels through the actual eight-check registry and
adds failure/boundary cases, including Googlebot/our-bot separation, headers,
redirect-final canonicals, weak/conflicting language and regional evidence,
word boundaries, stemming, profile selection, and bounded evidence.

Run `uv run python scripts/calibrate_checks.py` from `apps/worker` to print
precision at 50. The 40-page set is synthetic smoke calibration only; its metric
does not estimate production accuracy. Real calibration still needs the
product-owned 100–200 labeled URLs from M5-PM2.
