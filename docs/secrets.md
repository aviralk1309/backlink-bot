# Secrets and env vars

## Web app
| Variable | Where | Who may hold it |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | web | public |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | web | public (RLS protects data) |
| SUPABASE_SERVICE_ROLE_KEY | web server only | server env only, never in client bundle |
| MAIL_MODE | web | server env only |
| MAIL_FROM | web | server env only |
| SMTP_HOST | web | server env only |
| SMTP_PORT | web | server env only |
| SMTP_USER | web | server env only |
| SMTP_PASS | web | server env only |
| BOOTSTRAP_ADMIN_EMAIL | bootstrap script only | operator's shell, never committed |
| BOOTSTRAP_ADMIN_NAME | bootstrap script only | operator's shell (optional) |
| BOOTSTRAP_ADMIN_PASSWORD | bootstrap script only | operator's shell, local use only (optional) |
| BOOTSTRAP_APP_URL | bootstrap script only | operator's shell (optional, default http://localhost:3000) |

## Worker
| Variable | Where | Who may hold it | Default |
|---|---|---|---|
| DATABASE_URL | worker | worker host only | **required** |
| LOG_LEVEL | worker | operator | INFO |
| HEARTBEAT_SECONDS | worker | operator | 15 |
| POLL_SECONDS | worker | operator | 5.0 |
| CLAIM_BATCH | worker | operator | 10 |
| WORKER_CONCURRENCY | worker | operator | 4 |
| LEASE_SECONDS | worker | operator | 120 |
| MAX_ATTEMPTS | worker | operator | 3 |
| SHUTDOWN_GRACE_SECONDS | worker | operator | 30.0 |
| POOL_MAX_SIZE | worker | operator | 10 |
| RUNNER_ENABLED | worker | operator | false |
| SERPER_API_KEY | worker (M8) | worker host only | **required for M8** |

## Test environment
| Variable | Where | Who may hold it | Default |
|---|---|---|---|
| TEST_WORKER_DATABASE_URL | worker integration tests | CI/CD, local | `postgresql://worker:worker@127.0.0.1:54322/postgres` |
| TEST_ADMIN_DATABASE_URL | worker integration tests | CI/CD, local | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

> **Note:** The worker `.env` file must contain at minimum `DATABASE_URL`. All other
> settings have sensible defaults for development. Production deployments should
tune `WORKER_CONCURRENCY`, `CLAIM_BATCH`, `LEASE_SECONDS` based on database
performance and available resources.