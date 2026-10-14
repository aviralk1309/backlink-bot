# Development Setup Guide

This guide walks you through setting up the Backlink Discovery Bot project from scratch on your local machine.

## Prerequisites

### System Requirements
- **Git** 2.30+
- **Node.js** 22+ (LTS recommended)
- **pnpm** 10.29.1+ (exact version specified in CI)
- **Python** 3.12+
- **uv** (Python package manager) or **Poetry** 1.7+
- **Docker** 20+ (for Supabase and database)
- **Supabase CLI** (for local database management)

### Recommended Tools
- **VS Code** with ESLint, Prettier, TypeScript, and Python extensions
- **PostgreSQL client** (psql, pgAdmin, or TablePlus)
- **Make** (for running common commands)

---

## 1. Clone the Repository

```bash
# Clone the repository
git clone <repository-url> backlink-bot
cd backlink-bot

# If you have SSH access
git clone git@github.com:<org>/backlink-bot.git
```

---

## 2. Install Dependencies

The project uses a monorepo structure with separate dependencies for web and worker.

### Web App (Next.js)

```bash
cd apps/web

# Install exact pnpm version (if not already installed)
corepack enable
corepack prepare pnpm@10.29.1 --activate

# Or use npm to install pnpm globally
npm install -g pnpm@10.29.1

# Install web dependencies
pnpm install --frozen-lockfile
```

### Worker (Python)

```bash
cd apps/worker

# Install uv (if not already installed)
pip install uv

# Sync dependencies from pyproject.toml and uv.lock
uv sync --frozen

# Alternative: if using Poetry
poetry install --no-root
```

### Project Root

```bash
cd /path/to/backlink-bot

# Install pre-commit hooks
pre-commit install --install-hooks
pre-commit install --hook-type commit-msg
```

---

## 3. Environment Setup

### Copy Example Files

```bash
# Web app
cp apps/web/.env.example apps/web/.env.local

# Worker
cp .env.example apps/worker/.env

# Root (if exists)
cp .env.example .env
```

### Web App Environment (`.env.local`)

```bash
# Required - Supabase connection
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Required - Service role key (server-side only, NEVER expose to browser)
SUPABASE_SERVICE_ROLE_KEY=

# Optional - For email/SMTP (if configured)
MAIL_MODE=smtp
MAIL_FROM=no-reply@backlink-bot.local
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=

# Optional - Development
NODE_ENV=development
```

**To get Supabase keys after starting the local stack:**
```bash
# After running `supabase start`, get the anon key
supabase config --local | grep anon

# Get the service role key
supabase config --local | grep service_role
```

### Worker Environment (`.env`)

```bash
# Required - Database connection
DATABASE_URL=postgresql://worker:worker@localhost:54322/postgres

# Optional - Worker configuration (defaults shown)
LOG_LEVEL=DEBUG
HEARTBEAT_SECONDS=15
POLL_SECONDS=5.0
CLAIM_BATCH=10
WORKER_CONCURRENCY=4
LEASE_SECONDS=120
MAX_ATTEMPTS=3
SHUTDOWN_GRACE_SECONDS=30.0
POOL_MAX_SIZE=10
RUNNER_ENABLED=true
```

---

## 4. Start the Database

The project uses Supabase as the database. For local development, use the Supabase CLI to run a local Postgres instance.

### Start Supabase

```bash
# Install Supabase CLI (if not already installed)
# On macOS:
brew install supabase/tap/supabase

# On Linux:
curl -fsSL https://raw.githubusercontent.com/supabase/cli/main/install.sh | sh

# On Windows (WSL or native):
winget install Supabase.CLI

# Start the local database stack
supabase start
```

The first run downloads Docker images (~2GB) and initializes the database. This may take several minutes.

### Verify Database is Running

```bash
# Check status
supabase status

# Or connect directly
psql -h localhost -p 54322 -U postgres -d postgres
# Password: postgres
```

### Reset Database (Clean State)

```bash
# Full reset: stops, removes, and restarts with fresh migrations
make db-reset

# Or manually:
supabase db reset

# If you need to completely restart
supabase stop
supabase start
supabase db reset
```

### Initialize Roles and Permissions

The worker needs a `worker` role with appropriate permissions. This is created by the migrations.

```bash
# After starting Supabase, verify the worker role exists
psql -h localhost -p 54322 -U postgres -d postgres -c "SELECT rolname FROM pg_roles WHERE rolname = 'worker';"

# If it doesn't exist, the migrations will create it
make db-reset
```

---

## 5. Generate TypeScript Types

The web app uses TypeScript types generated from the database schema.

```bash
# Generate types from local database
make types

# Or manually
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
cd apps/web && pnpm prettier --write src/lib/database.types.ts
```

---

## 6. Run the Development Servers

### Web App (Next.js)

```bash
cd apps/web
pnpm dev
```

The web app will be available at `http://localhost:3000`.

**Note:** You need to have the Supabase local stack running (`supabase start`) and the environment variables set in `.env.local`.

### Worker (Python)

```bash
cd apps/worker
uv run python -m worker
```

The worker will start, connect to the database, and log heartbeats every 15 seconds.

**Note:** The worker needs `RUNNER_ENABLED=true` in its `.env` file to pick up and process jobs.

### Run Both Together

In separate terminals:

```bash
# Terminal 1: Start database
supabase start

# Terminal 2: Generate types and start web
make types
cd apps/web && pnpm dev

# Terminal 3: Start worker
cd apps/worker && uv run python -m worker
```

---

## 7. Create First Admin User

Before you can use the dashboard, you need to create the first Admin user.

```bash
cd apps/web

# Run the bootstrap script
BOOTSTRAP_ADMIN_EMAIL=your-email@example.com \
BOOTSTRAP_ADMIN_PASSWORD=your-secure-password \
pnpm bootstrap:admin --confirm-url http://localhost:3000

# If you want to set a password later (recommended for development)
BOOTSTRAP_ADMIN_EMAIL=your-email@example.com \
pnpm bootstrap:admin --confirm-url http://localhost:3000
```

The script will output a one-time password setup link. Open it in your browser and set your password.

### Alternative: Using Supabase Dashboard

You can also create a user directly through the Supabase local dashboard:
1. Open `http://localhost:54323` (Supabase Studio)
2. Go to Authentication > Users
3. Create a new user with your email
4. Then use the bootstrap script to make them an Admin:

```bash
cd apps/web
BOOTSTRAP_ADMIN_EMAIL=your-email@example.com \
pnpm bootstrap:admin --confirm-url http://localhost:3000
```

---

## 8. Run the Full Test Suite

### Quick Check (Lint + Unit Tests)

```bash
# From project root
make check
```

This runs:
- Web: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`
- Worker: `ruff check`, `ruff format --check`, `mypy`, `pytest -m unit`, `pip-audit`

### Database Tests

```bash
# Reset and test the database
make db-verify

# Or manually:
make db-reset
make db-test
```

### Integration Tests

Integration tests require a running Supabase instance with the worker role.

```bash
# Start database if not running
supabase start

# Run integration tests
cd apps/worker
uv run pytest -m integration -v
```

### End-to-End Tests (Playwright)

```bash
# Install Playwright browsers (first time only)
cd apps/web
pnpm exec playwright install chromium

# Run e2e tests
pnpm e2e

# Or with UI
pnpm e2e --ui

# Or specific test file
pnpm e2e jobs.spec.ts
```

**Note:** E2E tests require:
- Local Supabase running (`supabase start`)
- Environment variables in `apps/web/.env.local` pointing to local Supabase
- At least one Admin user created (the tests create their own test users)

---

## 9. Common Development Commands

### Make Commands

| Command | Description |
|---------|-------------|
| `make setup` | Install pre-commit hooks, pnpm, and uv dependencies |
| `make check` | Run all linting, type-checking, and unit tests |
| `make db-start` | Start Supabase |
| `make db-stop` | Stop Supabase |
| `make db-reset` | Reset database with migrations |
| `make db-test` | Run database tests |
| `make db-verify` | Reset DB and run all DB tests |
| `make types` | Generate TypeScript types from database |
| `make dev-web` | Start web development server |
| `make dev-worker` | Start worker |
| `make e2e` | Run end-to-end tests |

### Web App Commands (from `apps/web`)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix ESLint issues |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm format:check` | Check Prettier formatting |
| `pnpm format:write` | Apply Prettier formatting |
| `pnpm test` | Run Vitest unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm e2e` | Run Playwright e2e tests |
| `pnpm bootstrap:admin` | Create first Admin user |

### Worker Commands (from `apps/worker`)

| Command | Description |
|---------|-------------|
| `uv sync` | Install dependencies |
| `uv sync --frozen` | Install exact versions from lockfile |
| `uv run python -m worker` | Start worker |
| `uv run ruff check .` | Run Ruff linter |
| `uv run ruff format --check .` | Check Ruff formatting |
| `uv run mypy src` | Run mypy type checking |
| `uv run pytest` | Run all Python tests |
| `uv run pytest -m unit` | Run unit tests only |
| `uv run pytest -m integration` | Run integration tests only |
| `uv run pytest -v` | Run tests with verbose output |
| `uv run pip-audit` | Audit Python dependencies |
| `docker build -t worker .` | Build Docker image |

### Supabase Commands

| Command | Description |
|---------|-------------|
| `supabase start` | Start local database stack |
| `supabase stop` | Stop local database stack |
| `supabase status` | Check status of local stack |
| `supabase db reset` | Reset database with migrations |
| `supabase db push` | Push migrations to remote |
| `supabase test db` | Run database tests |
| `supabase gen types typescript --local` | Generate TypeScript types |

---

## 10. Project Structure

```
backlink-bot/
├── .github/                    # GitHub Actions workflows
│   └── workflows/
│       └── ci.yml              # CI/CD pipeline
├── apps/
│   ├── web/                    # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/            # App Router pages and API routes
│   │   │   ├── components/     # React components
│   │   │   ├── features/      # Feature modules
│   │   │   ├── lib/           # Utilities and types
│   │   │   └── styles/       # CSS and Tailwind
│   │   ├── e2e/               # Playwright tests
│   │   ├── .env.example       # Example environment
│   │   ├── pnpm-lock.yaml     # Dependency lockfile
│   │   └── package.json
│   │
│   └── worker/                # Python worker
│       ├── src/
│       │   └── worker/
│       │       ├── engine/    # Job engine (claims, loop, runner, heartbeat)
│       │       ├── urls/      # URL normalization and domain extraction
│       │       ├── config/     # Configuration
│       │       ├── db/         # Database connection pool
│       │       ├── fetch/     # HTTP fetcher (M5)
│       │       ├── checks/    # Check functions (M5)
│       │       ├── scoring/   # Scoring (M5)
│       │       ├── providers/ # Search providers (M8)
│       │       └── main.py    # Worker entry point
│       ├── tests/
│       │   ├── unit/          # Unit tests
│       │   └── integration/   # Integration tests
│       ├── .venv/             # Python virtual environment
│       ├── pyproject.toml     # Python project config
│       └── uv.lock            # Dependency lockfile
│
├── supabase/                  # Database
│   ├── migrations/            # SQL migrations
│   ├── tests/                 # pgTAP tests
│   ├── seed.sql               # Seed data
│   └── config.toml            # Supabase config
│
├── docs/                     # Documentation
│   ├── adr/                  # Architecture Decision Records
│   ├── runbooks/             # Operations runbooks
│   ├── data-dictionary.md    # Database schema reference
│   ├── authorization.md      # Permissions and access control
│   ├── testing.md            # Testing guide
│   ├── secrets.md            # Environment variables
│   └── development.md        # This file
│
├── fixtures/                  # Test fixtures
│   └── url-normalization.json # URL test vectors
│
├── .pre-commit-config.yaml   # Git hooks
├── Makefile                   # Common commands
├── mvps.md                   # MVP breakdown and task plan
└── README.md                  # Product overview
```

---

## 11. Troubleshooting

### Database Connection Issues

**Problem:** "Connection refused" or "could not connect to server"

```bash
# Check if Supabase is running
supabase status

# If not, start it
supabase start

# Check PostgreSQL directly
psql -h localhost -p 54322 -U postgres -d postgres
# Password: postgres

# If port is in use
lsof -i :54322
kill -9 <PID>
```

### Web App Fails to Start

**Problem:** "Error: Cannot find module" or dependency errors

```bash
cd apps/web
pnpm install --frozen-lockfile
pnpm dev
```

**Problem:** "Supabase URL not configured"

```bash
# Make sure .env.local exists with correct values
cp .env.example .env.local
# Edit and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### Worker Fails to Start

**Problem:** "DATABASE_URL not set" or connection errors

```bash
cd apps/worker
cp ../.env.example .env
# Edit and set DATABASE_URL
uv run python -m worker
```

**Problem:** "role 'worker' does not exist"

```bash
# Reset the database to create all roles
make db-reset
```

### Pre-commit Hooks Failing

```bash
# Install hooks
pre-commit install --install-hooks

# Run manually to see what's wrong
pre-commit run --all-files

# Skip hooks for a single commit (not recommended)
git commit --no-verify -m "message"
```

### TypeScript Errors

```bash
# Generate types from database
make types

# Reinstall web dependencies
cd apps/web
rm -rf node_modules
pnpm install --frozen-lockfile
```

### Python Type Checking Errors

```bash
cd apps/worker
uv run mypy src
```

---

## 12. Clean Up

To completely reset your development environment:

```bash
# Stop Supabase
supabase stop

# Remove containers and volumes
docker rm -f supabase-db supabase-studio supabase-kong supabase-rest supabase-realtime

# Remove Supabase data
rm -rf supabase/.temp

# Remove node_modules and virtual environment
rm -rf apps/web/node_modules
rm -rf apps/worker/.venv

# Remove generated files
rm -rf apps/web/.next
rm -f apps/web/src/lib/database.types.ts

# Reset git
Git reset --hard
```

---

## 13. Next Steps

After setting up the development environment:

1. **Familiarize yourself with the architecture** - Read `README.md` and `mvps.md`
2. **Explore the data model** - Check `docs/data-dictionary.md`
3. **Understand the permissions** - See `docs/authorization.md`
4. **Run the tests** - `make check` to verify everything works
5. **Create a test job** - Use the dashboard to create and start a job
6. **Check the worker logs** - See how it processes opportunities

---

## Quick Reference Card

```bash
# Full setup from scratch
git clone <repo> && cd backlink-bot
make setup
supabase start
make types
make db-reset

# Start development
# Terminal 1
supabase start
# Terminal 2
cd apps/web && pnpm dev
# Terminal 3
cd apps/worker && uv run python -m worker

# Create first user
cd apps/web
BOOTSTRAP_ADMIN_EMAIL=you@example.com pnpm bootstrap:admin --confirm-url http://localhost:3000

# Run all tests
make check
make db-verify
cd apps/web && pnpm e2e
cd apps/worker && uv run pytest

# Common issues
supabase status          # Check if DB is running
make db-reset           # Reset DB to clean state
make types              # Regenerate TypeScript types
```

---

## Support

- **Database issues**: Check `supabase logs` or `docker logs supabase-db`
- **Web app issues**: Check `pnpm dev` console output
- **Worker issues**: Check worker console output
- **TypeScript issues**: Run `pnpm typecheck` for detailed errors
- **Python issues**: Run `uv run mypy src` for type errors

---

*Last updated: MVP 3 completion*
