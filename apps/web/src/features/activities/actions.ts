"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/db-errors";
import { activityFormInput, saveActivitySchema } from "./schemas";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
};
const GONE: FormState = {
  error: "That activity no longer exists. Reload the page.",
};
const STALE: FormState = {
  error:
    "Someone else changed this activity while you were editing. Reload the page to see their changes, then make yours again.",
};

/**
 * Creates (activities.manage) or saves an activity profile. Runs under the
 * caller's own session, so RLS and the column grants are the real gate. The
 * key is sent only when creating (it can never change), and the version is
 * bumped by a trigger only when something really changed.
 */
export async function saveActivityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requirePermission("activities.manage");
  } catch (err) {
    if (err instanceof AuthError) return FORBIDDEN;
    throw err;
  }

  const parsed = saveActivitySchema.safeParse(activityFormInput(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { activity_id, key, name, enabled, seen_updated_at, config } =
    parsed.data;

  const values = { name, enabled, ...config };
  const supabase = await createClient();

  let savedId: string;
  if (activity_id) {
    // The updated_at match turns a lost update into a clear message.
    const { data: updated, error } = await supabase
      .from("activity_profiles")
      .update(values)
      .eq("id", activity_id)
      .eq("updated_at", seen_updated_at as string)
      .select("id");
    if (error) {
      console.error("saveActivityAction: update failed", error.message);
      return { error: describeDbError(error.message) };
    }
    if (!updated?.length) {
      // Either someone else saved first, or it is gone.
      const { data: still } = await supabase
        .from("activity_profiles")
        .select("id")
        .eq("id", activity_id)
        .maybeSingle();
      return still ? STALE : GONE;
    }
    savedId = activity_id;
  } else {
    const { data: created, error } = await supabase
      .from("activity_profiles")
      .insert({ key, ...values })
      .select("id")
      .single();
    if (error) {
      console.error("saveActivityAction: insert failed", error.message);
      return { error: describeDbError(error.message) };
    }
    savedId = (created as { id: string }).id;
  }

  revalidatePath("/admin/activities");
  revalidatePath(`/admin/activities/${savedId}`);
  // The job form lists activities too.
  revalidatePath("/jobs/new");
  redirect(`/admin/activities?saved=${activity_id ? "updated" : "created"}`);
}
