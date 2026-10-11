.PHONY: setup check db-start db-stop db-reset db-test types dev-web dev-worker e2e

setup:
	pre-commit install --install-hooks
	pre-commit install --hook-type commit-msg
	cd apps/web && pnpm install
	cd apps/worker && uv sync

check:
	cd apps/web && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
	cd apps/worker && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -m unit

db-start:
	supabase start

db-stop:
	supabase stop

db-reset:
	supabase db reset

db-test:
	supabase test db

types:
	supabase gen types typescript --local > apps/web/src/lib/database.types.ts
	cd apps/web && pnpm prettier --write src/lib/database.types.ts

dev-web:
	cd apps/web && pnpm dev

dev-worker:
	cd apps/worker && uv run python -m worker

e2e:
	cd apps/web && pnpm e2e

db-verify: db-reset db-test