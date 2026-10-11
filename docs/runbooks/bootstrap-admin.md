# Bootstrap the first Admin

Use once per environment, when nobody can sign in as Admin yet. Also safe to
run later to restore an Admin you locked out through the database.

## Run

Run from `apps/web` on a machine you trust: the script uses the service key.

    cd apps/web
    BOOTSTRAP_ADMIN_EMAIL=you@example.com \
    BOOTSTRAP_ADMIN_NAME="Your Name" \
    pnpm bootstrap:admin --confirm-url <NEXT_PUBLIC_SUPABASE_URL>

`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from the
shell or `apps/web/.env.local`. `--confirm-url` must equal that URL exactly,
so a run against the wrong environment stops before it touches anything.

## What it does

| Situation | Result |
|---|---|
| No such user | Creates the user, makes them an active Admin. With `BOOTSTRAP_ADMIN_PASSWORD` set, the password is set. Without it, a one-time set-password link is printed. |
| User exists, not an active Admin (pending, rejected, deactivated, other role) | Promotes them to active Admin. Their password is not changed. |
| Already an active Admin | Nothing changes. |

## Hosted environments

Do not set `BOOTSTRAP_ADMIN_PASSWORD`. Use the printed link, open it once, and
set a password. The link signs in whoever holds it, so do not paste it into
chat or tickets. Set `BOOTSTRAP_APP_URL` to the real site URL so the link
points there.

## Check

Sign in, open Admin, Users. You should see yourself with role Admin. The
script also prints how many active Admins exist.

## If it fails

| Message | Fix |
|---|---|
| `--confirm-url does not match` | The URL in the flag differs from `NEXT_PUBLIC_SUPABASE_URL`. Check which environment you meant. |
| `The Admin role is missing` | Migrations have not run. `make db-reset` locally, `supabase db push` elsewhere. |
| `Could not read profiles` | Wrong service key or URL. |
| `Could not make the user an Admin` | The script removes a user it just created. Check database logs, then run again. |