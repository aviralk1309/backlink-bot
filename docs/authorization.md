# Authorization

Who may do what is decided in the database. Everything above the database
is a courtesy that keeps the screens honest and the messages clear.

## Layers, strongest first

| Layer | Where | What it does | Can it be bypassed? |
|---|---|---|---|
| Row-level security and triggers | `supabase/migrations` (`has_permission`, policies, lockout guards) | Refuses the read or write | No, unless the service key is used |
| Server actions | `requirePermission(key)` in `src/lib/auth/session.ts`, first line of every privileged action | Clear error message, early exit | Only by calling the database directly, where RLS still applies |
| Page guard | `requirePagePermission(requirement)` in `src/lib/auth/guard.ts`, first line of every protected page | Signed-out users go to login, others get the No access page | Yes. A page that forgets it still gets no data, because queries run as the user |
| Hiding UI | `<Can>` in `src/components/can.tsx`, `visibleNavItems`, `visibleAdminSections` | Hides links and buttons the user cannot use | Yes, by typing the URL. The layers above still hold |

The service key (`createAdminClient`) bypasses RLS. Use it only inside server
code, only after a permission check, and never in a client bundle.

## Rules for new code

1. Every new table gets RLS in the same migration, plus a pgTAP test.
2. Every new privileged action starts with `requirePermission("...")`.
3. Every new protected page starts with `requirePagePermission("...")`.
4. Use `<Can>` only to hide things. Never rely on it to protect them.
5. Client components get plain boolean props, never the permission list.

## Adding a permission

1. New migration: insert into `public.permissions` and grant it to Admin
   (see `20261008075439_m1_seed_permissions_roles.sql`). The catalog changes
   only through migrations.
2. Update the count and role mapping assertions in
   `supabase/tests/database/010_identity.test.sql`.
3. If it gates a nav item, add it to `src/lib/nav-access.ts` and
   `src/lib/admin-nav.ts`.
4. Use `requirePermission` and `requirePagePermission` where it applies.

## The No access page

`forbidden()` renders `src/app/(app)/forbidden.tsx` inside the app layout, so
the navbar stays. Pages stream inside `<Suspense>`, so the HTTP status is
already 200 when the check runs. This is accepted: the page is real and
dedicated, and the database is the gate, not the status code. See ADR 0013.

## Roles and `roles.manage`

`roles.manage` is admin-equivalent. See ADR 0012.

## Tests that prove this

- `supabase/tests/database/010_identity.test.sql` and `020_role_builder.test.sql`:
  RLS and lockout guards.
- `apps/web/src/lib/auth/permissions.test.ts`: the permission rule.
- `apps/web/e2e/authorization.spec.ts`: a Viewer is shown No access on admin
  pages, and direct API calls (insert, RPC, escalate, delete) are refused.
- `apps/web/e2e/role-builder.spec.ts`: a role's permissions change what its
  users can see.