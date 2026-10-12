"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/db-errors";
import { addSummary } from "./rules";
import {
  addBlocklistSchema,
  removeBlocklistSchema,
  updateReasonSchema,
} from "./schemas";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
};
const GONE: FormState = {
  error: "That entry no longer exists. Reload the page.",
};

/** First line of every action here: the caller must hold blocklist.manage. */
async function allowed(): Promise<boolean> {
  try {
    await requirePermission("blocklist.manage");
    return true;
  } catch (err) {
    if (err instanceof AuthError) return false;
    throw err;
  }
}

const refresh = () => revalidatePath("/admin/blocklist");

/**
 * Adds one or many domains with a shared reason. Domains already on the list
 * are skipped, not errors. RLS and the column grants are the real gate.
 */
export async function addBlockedDomainsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await allowed())) return FORBIDDEN;

  const parsed = addBlocklistSchema.safeParse({
    domains: formData.get("domains") ?? undefined,
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { domains, reason } = parsed.data;

  const supabase = await createClient();
  // ignoreDuplicates makes this "on conflict do nothing", and only the rows
  // really inserted come back, which gives the added/skipped counts.
  const { data, error } = await supabase
    .from("blocklist")
    .upsert(
      domains.map((domain) => ({ domain, reason })),
      { onConflict: "domain", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("addBlockedDomainsAction failed", error.message);
    return { error: describeDbError(error.message) };
  }

  const added = data?.length ?? 0;
  refresh();
  return { message: addSummary(added, domains.length - added) };
}

export async function updateBlockReasonAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await allowed())) return FORBIDDEN;

  const parsed = updateReasonSchema.safeParse({
    id: formData.get("id") ?? undefined,
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blocklist")
    .update({ reason: parsed.data.reason })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    console.error("updateBlockReasonAction failed", error.message);
    return { error: describeDbError(error.message) };
  }
  if (!data?.length) return GONE;

  refresh();
  return { message: "Reason saved." };
}

export async function removeBlockedDomainAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await allowed())) return FORBIDDEN;

  const parsed = removeBlocklistSchema.safeParse({
    id: formData.get("id") ?? undefined,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blocklist")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    console.error("removeBlockedDomainAction failed", error.message);
    return { error: describeDbError(error.message) };
  }
  if (!data?.length) return GONE;

  refresh();
  return { message: "Domain removed." };
}
