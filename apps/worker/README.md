# Background worker

The Python worker claims queued jobs and CSV uploads from Postgres, discovers and checks backlink prospects, scores results, and updates job progress. Optional tasks handle paid Serper search, focused site crawling, placed-link verification, rescoring, and Storage cleanup.

See the [project overview](../../README.md), [worker runbook](../../docs/runbooks/worker.md), [environment variables](../../docs/secrets.md), and [testing guide](../../docs/testing.md) for setup and operating details.

## Run locally

Start Supabase from the repository root, then create `.env.local` from `.env.example` and set `DATABASE_URL` to the local `worker` database role. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the same local stack for Storage. `make dev-worker` selects this profile. For a cloud worker, use a separate ignored `.env.production` with the existing restricted worker-role password in `DATABASE_URL` and matching cloud Storage credentials, then run `make prod-worker`. Paid search remains disabled.

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
