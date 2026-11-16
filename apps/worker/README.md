# Background worker

The Python worker claims queued jobs and CSV uploads from Postgres, discovers and checks backlink prospects, scores results, and updates job progress. Optional tasks handle paid Serper search, focused site crawling, placed-link verification, rescoring, and Storage cleanup.

See the [project overview](../../README.md), [worker runbook](../../docs/runbooks/worker.md), [environment variables](../../docs/secrets.md), and [testing guide](../../docs/testing.md) for setup and operating details.

## Run locally

Start Supabase from the repository root, then create `.env` from `.env.example` and set `DATABASE_URL` to the worker database role. Storage cleanup also needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Search is disabled by default; enable it only when `SERPER_API_KEY` is configured.

```sh
uv sync --frozen
uv run python -m worker
```

## Checks

```sh
uv run ruff check .
uv run mypy src
uv run pytest -m unit
uv run pytest -m integration
```

Integration tests require a local Supabase database configured for the worker role. See the [runbook](../../docs/runbooks/worker.md) for queue behavior, retry rules, and monitoring.
