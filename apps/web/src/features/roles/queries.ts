import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PermissionRow, RoleDetail } from "./types";

// The Supabase clients are not typed with the generated Database type yet,
// so query results are described here by hand.
type PermissionQueryRow = PermissionRow;
type RoleQueryRow = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_protected: boolean;
  role_permissions: { permission_key: string }[] | null;
};
type CountRow = { role_id: string; user_count: number | string };

/** Runs as the signed-in user, so RLS decides what comes back. */
export const listPermissions = cache(async (): Promise<PermissionRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("permissions")
    .select("key, group, description")
    .order("key");
  if (error) throw new Error(`listPermissions failed: ${error.message}`);
  return (data ?? []) as PermissionQueryRow[];
});

/** role_id -> number of profiles holding it. Needs roles.manage. */
export async function getRoleUserCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("role_user_counts");
  if (error) throw new Error(`role_user_counts failed: ${error.message}`);
  return new Map(
    ((data ?? []) as CountRow[]).map((c) => [c.role_id, Number(c.user_count)]),
  );
}

/**
 * Every role with its permission keys and user count. One embedded select
 * plus one RPC. Cached per request, so a page and its helpers share it.
 */
export const listRoleDetails = cache(async (): Promise<RoleDetail[]> => {
  const supabase = await createClient();
  const [rolesRes, counts] = await Promise.all([
    supabase
      .from("roles")
      .select(
        "id, name, description, is_system, is_protected, role_permissions(permission_key)",
      )
      .limit(500),
    getRoleUserCounts(),
  ]);
  if (rolesRes.error) {
    throw new Error(`listRoleDetails failed: ${rolesRes.error.message}`);
  }

  return ((rolesRes.data ?? []) as RoleQueryRow[])
    .map((r) => {
      const keys = (r.role_permissions ?? [])
        .map((p) => p.permission_key)
        .sort();
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        is_system: r.is_system,
        is_protected: r.is_protected,
        user_count: counts.get(r.id) ?? 0,
        permission_count: keys.length,
        permission_keys: keys,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

export async function getRoleDetail(id: string): Promise<RoleDetail | null> {
  const roles = await listRoleDetails();
  return roles.find((r) => r.id === id) ?? null;
}
