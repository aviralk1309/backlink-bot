# Production deployment

This Compose stack runs the Next.js app and Python worker on one VPS. Supabase
Cloud remains the database, Auth, and Storage provider. Cloudflare Tunnel
publishes only the web service; neither app container has a public port.

## 1. Prepare the Supabase project

Back up the project first. From a trusted machine, link the repository to the
intended Supabase project, compare migration history, and preview unapplied SQL:

```sh
supabase login
supabase link --project-ref <project-ref>
supabase migration list --remote
supabase db push --dry-run --remote
```

Review every pending migration against the current cloud schema before applying
it. Do not run `supabase db reset` or `--include-seed` against the hosted project.
When the preview is correct, apply the migrations with `supabase db push --remote`.

The migrations create a `worker` role without login. Connect to the cloud
database as an admin using `psql`, then use its interactive password prompt:

```text
\password worker
ALTER ROLE worker LOGIN;
```

Use a unique password from your password manager. Then use Supabase's Session
pooler connection string with username `worker.<project-ref>` for
`DATABASE_URL`. Do not use the `postgres` role for the application worker.

In Supabase Auth URL Configuration, set Site URL to the production app origin
and keep email confirmations disabled: the app creates sign-up requests and
does its own admin approval and email flow. The app's SMTP links return to
`/auth/confirm` on the public hostname.

## 2. Prepare Cloudflare

Create a remotely managed Tunnel and a published application route for
`app.example.com` with service URL `http://web:3000`. Copy the tunnel token into
the deployment environment file. Cloudflare Tunnel makes an outbound
connection, so the VPS does not need inbound HTTP or HTTPS ports.

## 3. Prepare the Hostinger VPS

Use a supported Ubuntu LTS image, install Docker Engine with the Compose plugin,
and allow SSH only from trusted addresses. Keep inbound ports 80 and 443 closed;
the tunnel uses outbound connectivity. Clone this repository on the VPS and
move into `deploy/production`.

## 4. Configure and start

```sh
cp production.env.example production.env
chmod 600 production.env
```

Fill in the Supabase URL, anon key, server-only service role key, worker-role
Session pooler URI, SMTP credentials, production URL, real crawler contact, and
Cloudflare Tunnel token. Keep `SEARCH_ENABLED=false` until a Serper key and
credit budget are intentionally configured. Keep crawler checks disabled until
the `BOT_USER_AGENT` identifies a real service contact.

```sh
docker compose --env-file production.env up -d --build
docker compose --env-file production.env ps
docker compose --env-file production.env logs --tail=100 web worker cloudflared
```

Then run the first-admin bootstrap from a trusted machine with the production
Supabase URL and service role key in `apps/web/.env.local`. Set
`BOOTSTRAP_APP_URL=https://app.example.com`, do not set
`BOOTSTRAP_ADMIN_PASSWORD`, and follow [the bootstrap runbook](../../docs/runbooks/bootstrap-admin.md).

## Updating

```sh
git pull --ff-only
docker compose --env-file production.env up -d --build
```

The Supabase project remains the durable data store. Keep a current Supabase
backup and a copy of `production.env` in a secure password manager; never commit
that file.
