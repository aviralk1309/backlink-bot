# Data dictionary

Source of truth for schema is `supabase/migrations`. This file explains what
the columns mean and who may touch them. Update it in the same change as a
migration.

## M1: identity

### `public.roles`
| Column | Type | Meaning |
|---|---|---|
| id | uuid | Primary key. Starter roles use fixed ids (`a0000000-...-0001` Admin, `-0002` Manager, `-0003` Viewer). |
| name | text | Required, not blank, unique ignoring case. |
| description | text | Optional. |
| is_system | boolean | Starter role. Cannot be changed after creation. |
| is_protected | boolean | Cannot be deleted and must keep `roles.manage` and `users.manage`. Only Admin. Cannot be changed after creation. |
| created_at, updated_at | timestamptz | `updated_at` maintained by trigger. |

Write rules: needs `roles.manage`. New roles cannot be system or protected.
Delete is blocked for protected roles and roles that still have profiles.

### `public.permissions`
| Column | Type | Meaning |
|---|---|---|
| key | text | Primary key, for example `jobs.view`. |
| group | text | Jobs, Results, Data or Admin. Used to group the role builder matrix. |
| description | text | Shown next to the checkbox. |

The catalog changes only through migrations. No client write is allowed, not
even for Admin. A migration that adds a permission must also grant it to
Admin.

### `public.role_permissions`
| Column | Type | Meaning |
|---|---|---|
| role_id | uuid | References `roles`, deleted with the role. |
| permission_key | text | References `permissions`, deleted with the permission. |

Primary key is both columns. On a protected role, `roles.manage` and
`users.manage` cannot be removed.

### `public.profiles`
| Column | Type | Meaning |
|---|---|---|
| id | uuid | Same as `auth.users.id`. Deleted with the auth user. |
| email | text | Lower-cased, unique ignoring case. Not editable from the client. |
| full_name | text | Display name. |
| role_id | uuid | Null while pending. Required once active. |
| status | `profile_status` | `pending`, `active`, `rejected`, `deactivated`. Only `active` users hold permissions. |
| approved_by, approved_at | uuid, timestamptz | Who approved the account and when. |
| created_at, updated_at | timestamptz | |

A profile is created automatically, as pending, when an auth user is created.
Inserts and deletes happen only through that trigger and the service key.
Clients may update `full_name`, `role_id`, `status`, `approved_by` and
`approved_at`, and only with `users.manage`. The last active Admin cannot be
deactivated, demoted or deleted.

### Functions
| Function | Who | What |
|---|---|---|
| `has_permission(key)` | signed-in | True when the caller is active and holds `key`. Used by every RLS policy. |
| `current_role_id()` | signed-in | The caller's role id when active, else null. |
| `save_role(id, name, description, keys[])` | `roles.manage` | Creates or updates a role and sets its exact permission set in one transaction. Runs as the caller, so RLS and guards apply. Null `id` creates. |
| `role_user_counts()` | `roles.manage` | Profiles per role, all statuses. Security definer so it sees every profile. |

### Error codes the app maps to messages
`lockout_protected_role`, `lockout_role_in_use`, `lockout_admin_permission`,
`lockout_last_admin`, `invalid_permission`, `role_not_found`, `forbidden`,
and unique violation `roles_name_lower_key`. See `apps/web/src/lib/db-errors.ts`.