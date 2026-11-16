# Manual UI sample uploads

Follow [the manual UI guide](../../docs/manual-ui-test-guide.md) for setup,
copyable form values, expected results and negative tests.

Synthetic fixtures only. Map **Source URL** as the source/referring-page URL.

| File | Purpose | Expected total / valid / invalid / empty / duplicates |
|---|---|---|
| 01-competitor-a.csv | Mixed rows, label rival-a.com | 6 / 3 / 2 / 1 / 1 |
| 02-competitor-b.csv | Overlap, label rival-b.com | 2 / 2 / 0 / 0 / 0 |
| 03-client.csv | Exclude example.net from gap | 1 / 1 / 0 / 0 / 0 |
| 04-all-invalid.csv | Error report | 2 / 0 / 2 / 0 / 0 |
| 05-alternate-delimiter.tsv | Tab delimiter | 1 / 1 / 0 / 0 / 0 |
| 06-quoted-multiline.csv | Quoting, comma and embedded newline | 1 / 1 / 0 / 0 / 0 |
| 07-header-only.csv | No data records | 0 / 0 / 0 / 0 / 0 |
| 08-empty.csv | Zero-byte input | Upload rejection |
| 09-wrong-extension.json | Unsupported extension | Upload rejection |

These counts were verified with the actual worker validator, using a mock database
sink; this fixture check did not create any jobs or upload objects. Main files use
reserved example domains. Their paths are test identifiers, not live crawl targets.
