# Serper credit verification

Status: completed on 2026-10-30 (UTC).

Operator run: three sequential requests maximum; no retries or raw responses saved.
Query: `backlink outreach`. Check the account dashboard against reported values.

| Case | num | page | HTTP | organic results | body `credits` | header `x-credits-used` |
|---|---:|---:|---:|---:|---:|---:|
| 10 results | 10 | 1 | 200 | 10 | 1 | unreported |
| 20 results | 20 | 1 | 200 | 10 | 1 | unreported |
| page 2 | 10 | 2 | 200 | 10 | 1 | unreported |

Credit-related body fields: credits.
Credit-related header fields: none.

Reported total: 3 credits across 3 calls.
The `num=20` request returned no more organic results than `num=10`; use 10 as
the default until more results are demonstrated.
Page 2 was a separate call. Dashboard balance was not independently reconciled.

`unreported` is unknown, never zero. The provider requires a valid body
`credits` value before accepting a search response. M8-S5 must count that value;
a timed-out call has uncertain spend.
