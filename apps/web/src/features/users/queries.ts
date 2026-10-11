import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProfileStatus } from "@/lib/auth/gate";
import type { RoleOption, UserRow } from "./types";

/** Runs as the signed-in user, so RLS decides what comes back. */
export async function listUsers(): Promise<UserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, status, role_id, created_at, roles(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  return (data ?? []).map((r) => {
    const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
    return {
      id: r.id,
      email: r.email,
      full_name: r.full_name,
      status: r.status as ProfileStatus,
      role_id: r.role_id,
      role_name: role?.name ?? null,
      created_at: r.created_at,
    };
  });
}

export async function listRoles(): Promise<RoleOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, name")
    .order("name");
  if (error) throw new Error(`listRoles failed: ${error.message}`);
  return (data ?? []) as RoleOption[];
}
