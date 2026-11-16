# Web dashboard

The Next.js app provides sign-in, job setup and monitoring, CSV mapping, results review, reporting, and admin tools. See the [project overview](../../README.md) and [development setup](../../docs/development.md) for the full system and local setup.

## Run locally

From this directory, install dependencies and create `.env.local` from `.env.example`. Set the local Supabase URL, anon key, and server-only service role key; see [environment variables](../../docs/secrets.md).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The dashboard runs at `http://localhost:3000`. Supabase must be running from the repository root. To create the first admin user, follow [the bootstrap guide](../../docs/development.md#7-create-first-admin-user).

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

Browser tests require local Supabase and use the setup described in the [testing guide](../../docs/testing.md).
