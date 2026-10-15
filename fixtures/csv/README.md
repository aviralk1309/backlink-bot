# CSV fixtures (M4)

**Everything here is synthetic.** Domains are made up (`fixture-*`, `rival-fixture.com`). Header names imitate Ahrefs, Semrush and Google Search Console exports from memory, so they may differ slightly from the real ones. What matters for the file reader is the encoding, delimiter, quoting, preamble and broken rows, and those are deliberate.

Regenerate: `python3 scripts/make_csv_fixtures.py`. Check: `python3 scripts/make_csv_fixtures.py --check`. Perf file (do not commit): `--big 1000000`.
`manifest.json` is the ground truth for tests: encoding, delimiter, header line, URL column, record counts, and a per-line category for `edge_messy.csv`.

| File | What it tests |
|---|---|
| `ahrefs-like_utf8-bom.csv` | Wide export, UTF-8 BOM, a quoted cell with a newline in it |
| `ahrefs-like_utf16le-tab.csv` | UTF-16 LE with BOM, tab delimiter |
| `semrush-like_quoted.csv` | Every field quoted |
| `gsc-like_top-linking-sites.csv` | Bare domains, no URLs |
| `gsc-like_latest-links.csv` | Plain page URLs |
| `edge_messy.csv` | 29 rows: duplicates, bad schemes, no scheme, IP and localhost, over-length URLs, ragged rows, blank line |
| `edge_semicolon_cp1252.csv` | Semicolon delimiter, Windows-1252 (not valid UTF-8) |
| `edge_preamble_header.csv` | Header is on line 4 |
| `edge_duplicate_headers.csv` | Two columns named `URL`, one blank header |
| `edge_headers_only.csv`, `edge_empty.csv` | No data rows, 0 bytes |

## Getting real exports later (20 to 50 rows is enough)

Put them in `fixtures/csv/real/` (keep out of git). Any domain works, including a public competitor.

- **Google Search Console (free, only for a site you or a client own):** Search Console, pick the property, Links, External links. In "Top linking sites" click Export, then Download CSV. Also try the export under "Latest links" if it is offered.
- **Ahrefs:** Site Explorer, enter a domain, Backlinks, Export (CSV). Needs a paid plan or trial for other people's domains. Ahrefs Webmaster Tools is free for sites you verify yourself.
- **Semrush:** Backlink Analytics, enter a domain, Backlinks tab, Export CSV. Export needs a paid plan, as far as I know.
- **Easiest:** ask the SEO person or client who already has these tools to export 20 to 50 rows of any domain. Message you can forward:
  > Could you export a small backlink CSV (even 20 to 50 rows) from Ahrefs, Semrush and Google Search Console, exactly as the tool gives it, without opening and re-saving it in Excel? Any domain is fine. Please send the original files.

Do not open and re-save real exports in Excel or Numbers. That changes the encoding and delimiter, which is exactly what we need to see.
