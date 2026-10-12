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

## Jobs, activities and the blocklist (M2)

M2 added no permissions. It uses the ones already in the catalog.

| Permission | What it allows | Where it is enforced |
|---|---|---|
| `jobs.view` | See jobs, their settings, history and activity log | RLS on `jobs`, `job_config_history`, `job_events`; `/jobs` pages |
| `jobs.create` | Create a job | RLS insert; `/jobs/new`; `saveJobAction` |
| `jobs.edit` | Change a job's settings while it is not finished | RLS update; `/jobs/[id]/edit`; `saveJobAction` |
| `jobs.delete` | Delete a job that is not Queued or Running | RLS delete; `deleteJobAction` |
| `jobs.start` | Start a Draft | `transition_job`; `jobTransitionAction` |
| `jobs.control` | Pause, resume and stop | `transition_job`; `jobTransitionAction` |
| `activities.manage` | Create and edit activity profiles | RLS insert and update; `/admin/activities` |
| `blocklist.manage` | See and change the global blocklist | RLS on `blocklist`; `/admin/blocklist` |

Reading activity profiles needs no permission beyond being an active user,
because the job form lists them.

### What to know

- **Status is never written by a client.** Column grants stop it. Users change
  status only through `transition_job`, which checks the permission and the
  state machine. Workers use `worker_transition_job`, which only the service
  role can call.
- **`jobs.create` effectively needs `jobs.view`.** Creating a job reads the new
  row back, and the read is refused without `jobs.view`. A custom role with
  `jobs.create` but not `jobs.view` therefore cannot create jobs. Give both.
- **Finished jobs are read-only.** Completed, failed and stopped jobs cannot be
  edited, even by Admin. This is checked in the app. Deleting one is still
  allowed with `jobs.delete`.
- **Names in the activity log.** The log shows who acted, but a person's name
  comes from `profiles`, which only `users.manage` can read. Everyone else sees
  "A team member". Worker events show "System".
- **Source job on the blocklist.** The link to the job that blocked a domain
  shows only for users who also hold `jobs.view`.
- **Disabling an activity** never blocks edits. A job keeps a disabled activity
  it already had, but cannot add one.
- **The Admin link** shows when the user holds any admin permission
  (`users.manage`, `roles.manage`, `activities.manage` or `blocklist.manage`),
  and each admin tab shows only for its own permission.
- **Default roles.** M2 did not change what Admin, Manager and Viewer hold.
  Admin has every permission. Manager can view jobs but not create them. Check
  `supabase/migrations/*_m1_seed_permissions_roles.sql` for the exact grants.

## Tests that prove this

- `supabase/tests/database/010_identity.test.sql` and `020_role_builder.test.sql`:
  RLS and lockout guards.
- `supabase/tests/database/040_jobs_rls.test.sql`: who can read and write jobs,
  activities and the blocklist, and that clients cannot write status.
- `supabase/tests/database/050_job_state_machine.test.sql`: legal and illegal
  transitions, permissions, and config versioning.
- `supabase/tests/database/060_activity_seed.test.sql`: the starter activities.
- `apps/web/src/lib/auth/permissions.test.ts`: the permission rule.
- `apps/web/src/lib/admin-nav.test.ts` and `nav-access-admin.test.ts`: which
  links show for which permission.
- `apps/web/e2e/authorization.spec.ts`: a Viewer is shown No access on admin
  pages, and direct API calls (insert, RPC, escalate, delete) are refused.
- `apps/web/e2e/role-builder.spec.ts`: a role's permissions change what its
  users can see.
- `apps/web/e2e/jobs.spec.ts`: the job lifecycle, activities and blocklist as
  Admin, and that a Viewer is refused both on screen and through the API.