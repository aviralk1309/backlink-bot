# Secrets and env vars
| Variable | Where | Who may hold it |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | web | public |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | web | public (RLS protects data) |
| SUPABASE_SERVICE_ROLE_KEY | web server only | server env only, never in client bundle |
| DATABASE_URL | worker | worker host only |
| SERPER_API_KEY | worker (M8) | worker host only |
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