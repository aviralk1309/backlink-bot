import type { SupabaseClient } from "@supabase/supabase-js";

// Seeded starter-role ids (supabase/migrations/..._m1_seed_permissions_roles.sql).
export const ADMIN_ROLE_ID = "a0000000-0000-0000-0000-000000000001";
export const VIEWER_ROLE_ID = "a0000000-0000-0000-0000-000000000003";
export const MANAGER_ROLE_ID = "a0000000-0000-0000-0000-000000000002";

// Local-only test credentials. env.ts refuses non-local databases.
export const E2E_PASSWORD = "E2e-Passw0rd!x1";
export const E2E_ADMIN = {
  email: "e2e-admin@example.com",
  fullName: "E2E Admin",
};
export const E2E_USER = {
  email: "e2e-user@example.com",
  fullName: "E2E User",
};
export const E2E_ROLE_PREFIX = "e2e-role-";

async function ensureUser(
  admin: SupabaseClient,
  u: { email: string; fullName: string; roleId: string },
) {
  const created = await admin.auth.admin.createUser({
    email: u.email,
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: u.fullName },
  });

  let id = created.data.user?.id;
  if (!id) {
    if (created.error?.code !== "email_exists") {
      throw new Error(`createUser failed: ${created.error?.message}`);
    }
    // Left over from an earlier run: find it and reset the password.
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", u.email)
      .maybeSingle();
    if (!existing) throw new Error(`No profile found for ${u.email}`);
    id = existing.id as string;
    const reset = await admin.auth.admin.updateUserById(id, {
      password: E2E_PASSWORD,
    });
    if (reset.error) throw new Error(`reset failed: ${reset.error.message}`);
  }

  // The new-user trigger made a pending profile; activate it with the role.
  const { error } = await admin
    .from("profiles")
    .update({ status: "active", role_id: u.roleId, full_name: u.fullName })
    .eq("id", id);
  if (error) throw new Error(`profile update failed: ${error.message}`);
}

/** Idempotent: safe to run before every test run. */
export async function seedE2e(admin: SupabaseClient) {
  await ensureUser(admin, { ...E2E_ADMIN, roleId: ADMIN_ROLE_ID });
  await ensureUser(admin, { ...E2E_USER, roleId: VIEWER_ROLE_ID });

  // Roles from a failed earlier run. The user is back on Viewer by now, so
  // the in-use guard will not block this.
  const { error } = await admin
    .from("roles")
    .delete()
    .like("name", `${E2E_ROLE_PREFIX}%`);
  if (error) throw new Error(`role cleanup failed: ${error.message}`);
}