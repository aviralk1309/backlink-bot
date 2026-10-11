"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { describeDbError } from "@/lib/db-errors";
import { planRoleDelete, planRoleSave } from "./rules";
import { deleteRoleSchema, roleFormInput, saveRoleSchema } from "./schemas";
import { getRoleUserCounts } from "./queries";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
};
const GONE: FormState = {
  error: "That role no longer exists. Reload the page.",
};

/** First line of every action here: the caller must hold roles.manage. */
async function actor() {
  try {
    return await requirePermission("roles.manage");
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
}

function refresh() {
  revalidatePath("/admin/roles");
  // The users screen lists role names in its pickers.
  revalidatePath("/admin/users");
}

export async function saveRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await actor();
  if (!session) return FORBIDDEN;

  const parsed = saveRoleSchema.safeParse(roleFormInput(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { role_id, name, description, permission_keys } = parsed.data;

  // Runs under the caller's own session: RLS and the lockout triggers are
  // the real gate, not just the checks below.
  const supabase = await createClient();

  // Never trust the client for "is this role protected": read it fresh.
  let role: { id: string; is_protected: boolean } | null = null;
  if (role_id) {
    const { data } = await supabase
      .from("roles")
      .select("id, is_protected")
      .eq("id", role_id)
      .maybeSingle();
    if (!data) return GONE;
    role = data;
  }

  const { data: catalog, error: catalogError } = await supabase
    .from("permissions")
    .select("key");
  if (catalogError) {
    console.error("saveRoleAction: catalog failed", catalogError.message);
    return { error: describeDbError(catalogError.message) };
  }

  const plan = planRoleSave({
    role,
    actorRoleId: session.roleId,
    keys: permission_keys,
    catalogKeys: (catalog ?? []).map((p) => p.key),
  });
  if (!plan.ok) return { error: plan.error };

  const { error } = await supabase.rpc("save_role", {
    // The generated type is not nullable, but null means "create" in SQL.
    p_role_id: (role?.id ?? null) as string,
    p_name: name,
    p_description: description,
    p_permission_keys: plan.keys,
  });
  if (error) {
    console.error("saveRoleAction: save_role failed", error.message);
    return { error: describeDbError(error.message) };
  }

  refresh();
  redirect(`/admin/roles?saved=${role ? "updated" : "created"}`);
}

export async function deleteRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await actor();
  if (!session) return FORBIDDEN;

  const parsed = deleteRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { role_id } = parsed.data;

  const supabase = await createClient();
  const { data: role } = await supabase
    .from("roles")
    .select("id, is_protected")
    .eq("id", role_id)
    .maybeSingle();
  if (!role) return GONE;

  let userCount = 0;
  try {
    userCount = (await getRoleUserCounts()).get(role.id) ?? 0;
  } catch (err) {
    console.error("deleteRoleAction: counts failed", err);
    return { error: "Could not check who uses this role. Try again." };
  }
  const plan = planRoleDelete({
    role,
    userCount,
    actorRoleId: session.roleId,
  });
  if (!plan.ok) return { error: plan.error };

  // If a user is assigned between the check and this delete, the
  // lockout_role_in_use trigger rejects it and describeDbError explains.
  const { data: deleted, error } = await supabase
    .from("roles")
    .delete()
    .eq("id", role.id)
    .select("id");
  if (error) {
    console.error("deleteRoleAction: delete failed", error.message);
    return { error: describeDbError(error.message) };
  }
  if (!deleted?.length) return FORBIDDEN;

  refresh();
  redirect("/admin/roles?saved=deleted");
}
