# ADR 0012: roles.manage is admin-equivalent
Status: Accepted
Context: M1-S7 adds the role builder. Anyone holding `roles.manage` can edit
any role's permissions, including the role they hold, so they can grant
themselves every permission in the catalog. The database already protects
the Admin role (lockout triggers from M1-S4: protected role cannot be
deleted, must keep `roles.manage` and `users.manage`, last active Admin
cannot be removed). It does not protect custom roles or the starter
Manager and Viewer roles, which stay editable and deletable when unused.
Decision:
1. Treat `roles.manage` as admin-equivalent. Grant it only to people who
   would be trusted as Admin. There is no tiered "can only grant what you
   hold" model.
2. Self-lockout is blocked in the application, not the database. The form
   locks `roles.manage` on your own role, and `planRoleSave` rejects a save
   that removes it. The Admin role keeps its DB-enforced protection.
3. Saving a role and its permission set is one transaction: SQL function
   `save_role` (security invoker, so RLS and lockout triggers still apply),
   diff-based so untouched rows never fire guards.
4. Per-role user counts come from `role_user_counts` (security definer,
   gated by `roles.manage`), because `profiles` RLS hides other users from
   callers without `users.manage`. It counts every profile with the role,
   matching the delete guard.
5. Concurrent edits to one role are last write wins. Role changes apply on
   the affected user's next request, because `getSession` reads
   permissions fresh each time.
6. Delete checks `planRoleDelete` first for a clear message. The
   `lockout_role_in_use` and `lockout_protected_role` triggers remain the
   final gate.
Alternatives:
- Tiered grants (a role manager may only grant permissions they hold):
  stronger, but more rules, more UI, and a harder permission model for a
  small admin team.
- Database trigger that blocks self-removal of `roles.manage`: rejected,
  because migrations and service-key scripts have no acting user, and
  another Admin may legitimately remove it.
- Two client calls (delete permissions, then insert): rejected, not atomic.
  A failure in between leaves a role with the wrong permissions.
- Optimistic locking on `roles.updated_at`: deferred. It is additive and
  can be added without a schema change.
Consequences: Handing out `roles.manage` is a high-trust decision and must
be reviewed like granting Admin. A custom role can be deleted or emptied by
any `roles.manage` holder, which is intended. Two admins editing the same
role at once can overwrite each other silently. The self-lockout check can
be bypassed by calling the database directly with the user's own session.
Reversibility: Easy. Everything is migrations plus app rules, and
optimistic locking or tiered grants can be added later.
Review trigger: A non-Admin role needs `roles.manage`. More than one person
edits roles regularly. The M9 security review. Any report of an overwritten
role edit.