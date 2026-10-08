# Secrets and env vars
| Variable | Where | Who may hold it |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | web | public |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | web | public (RLS protects data) |
| SUPABASE_SERVICE_ROLE_KEY | web server only | server env only, never in client bundle |
| DATABASE_URL | worker | worker host only |
| SERPER_API_KEY | worker (M8) | worker host only |