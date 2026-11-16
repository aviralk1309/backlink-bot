# Backlink Bot

Backlink Bot discovers backlink prospects for client websites, ranks them for review, and reports which discovery sources produce useful results. The bot suggests and scores prospects; people make the approval and rejection decisions.

## How it works

1. A user creates a job with a client site, target pages, niche, activities, and search settings.
2. The user can upload competitor backlink exports and the client's own backlink export. The app maps the CSV columns and the worker finds domains linking to competitors but not the client.
3. An optional Serper integration runs activity-specific Google searches within a configured credit budget.
4. The worker fetches candidate pages politely, applies checks and scoring, and puts results into review queues.
5. Reviewers approve, reject, or mark prospects as used. Reports and CSV exports summarize results and review outcomes.

Admins can manage users, roles and permissions, activity profiles, and the global blocklist.

## Architecture

- `apps/web`: Next.js dashboard, server actions, and API routes. Supabase Auth handles sign-in; database row-level security enforces data access.
- `apps/worker`: long-running Python worker for CSV ingestion, discovery, checks, scoring, and link verification.
- `supabase`: Postgres schema and RPCs, Auth and Storage configuration, migrations, seed data, and database tests. Postgres also coordinates worker queues and leases.
- `docs`: development setup, data dictionary, authorization rules, testing, runbooks, and architecture decisions.

## Local development

Prerequisites: Node.js 22+, pnpm 10, Python 3.12+, `uv`, Docker, and the Supabase CLI.

```sh
cd apps/web && pnpm install --frozen-lockfile
cd ../worker && uv sync --frozen
cd ../..
supabase start
supabase db reset
```

Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/worker/.env.example` to `apps/worker/.env`. Fill in the local Supabase keys and worker database connection; see [`docs/secrets.md`](docs/secrets.md). The worker's search integration is off by default; set `SERPER_API_KEY` and `SEARCH_ENABLED=true` to enable it.

Run the web app and worker in separate terminals:

```sh
make dev-web
make dev-worker
```

Create the first admin using the steps in [`docs/development.md`](docs/development.md#7-create-first-admin-user). For tests and database verification, see [`docs/testing.md`](docs/testing.md) and the Makefile targets.

## Project guides

- [Development setup](docs/development.md)
- [Data dictionary](docs/data-dictionary.md)
- [Authorization model](docs/authorization.md)
- [Worker runbook](docs/runbooks/worker.md)
- [Testing guide](docs/testing.md)
- [Architecture decisions](docs/adr/README.md)
