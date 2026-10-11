import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string;
  fullName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
};

export class AuthError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden") {
    super(code);
  }
}

/**
 * The signed-in, active user with their role and permissions, or null.
 * Cached per request. Permissions here drive the UI; the database enforces
 * the real rules through RLS, so this is never the only gate.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, status, role_id, roles(name)")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.status !== "active" || !profile.role_id) return null;

  const { data: grants } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", profile.role_id);

  const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    roleId: profile.role_id,
    roleName: role?.name ?? "",
    permissions: (grants ?? []).map((g) => g.permission_key as string),
  };
});

/** First line of every privileged server action. Throws AuthError. */
export async function requirePermission(key: string): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthError("unauthenticated");
  if (!session.permissions.includes(key)) throw new AuthError("forbidden");
  return session;
}

/** Permission keys of the signed-in user, or an empty list. */
export async function getPermissions(): Promise<string[]> {
  return (await getSession())?.permissions ?? [];
}
