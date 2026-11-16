"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requirePermission, type Session } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/db-errors";
import { addSummary } from "./rules";
import {
  addBlocklistSchema,
  blockFromReviewSchema,
  removeBlocklistSchema,
  undoReviewBlockSchema,
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

export type ReviewBlockState = FormState & {
  undo?: { id: string; jobId: string; domain: string; reason: string } | null;
  blocked?: boolean;
};

/** Block a domain only while a visible rejection still exists in this job. */
export async function blockFromReviewAction(
  _prev: ReviewBlockState,
  formData: FormData,
): Promise<ReviewBlockState> {
  let session: Session;
  try {
    session = await requirePermission("blocklist.manage");
  } catch (error) {
    if (error instanceof AuthError) return FORBIDDEN;
    throw error;
  }
  const supabase = await createClient();

  if (formData.get("intent") === "undo") {
    const parsed = undoReviewBlockSchema.safeParse({
      id: formData.get("id"),
      jobId: formData.get("job_id"),
      domain: formData.get("domain"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const { id, jobId, domain, reason } = parsed.data;
    const { data, error } = await supabase
      .from("blocklist")
      .delete()
      .eq("id", id)
      .eq("domain", domain)
      .eq("reason", reason)
      .eq("source_job_id", jobId)
      .eq("added_by", session.userId)
      .select("id");
    if (error) {
      console.error("blockFromReviewAction undo failed", error.message);
      return { error: describeDbError(error.message) };
    }
    if (!data?.length)
      return {
        error: "This entry changed or was removed. Check the global blocklist.",
        undo: null,
      };
    refresh();
    revalidatePath(`/jobs/${jobId}`);
    return {
      message: `${domain} removed from the global blocklist.`,
      undo: null,
    };
  }

  if (formData.get("intent") !== "add")
    return { error: "Invalid blocklist action." };
  try {
    await requirePermission("results.view");
  } catch (error) {
    if (error instanceof AuthError) return FORBIDDEN;
    throw error;
  }
  const parsed = blockFromReviewSchema.safeParse({
    jobId: formData.get("job_id"),
    resultId: formData.get("result_id") ?? undefined,
    domain: formData.get("domain") ?? undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { jobId, resultId, domain, reason } = parsed.data;
  const { data, error } = await supabase.rpc("block_rejected_domain", {
    p_job_id: jobId,
    p_result_id: resultId ?? null,
    p_domain: domain ?? null,
    p_reason: reason,
  });
  if (error) {
    console.error("blockFromReviewAction add failed", error.message);
    return { error: describeDbError(error.message) };
  }
  const row = data?.[0];
  if (!row || row.outcome === "not_rejected")
    return {
      error: "This domain no longer has a visible rejected result in this job.",
    };
  if (row.outcome === "already_blocked")
    return {
      message: `${row.blocked_domain} is already globally blocked.`,
      undo: null,
      blocked: true,
    };
  if (row.outcome !== "added" || !row.entry_id || !row.blocked_domain)
    return { error: "Could not add the domain to the blocklist. Try again." };
  refresh();
  revalidatePath(`/jobs/${jobId}`);
  return {
    message: `${row.blocked_domain} added to the global blocklist.`,
    undo: { id: row.entry_id, jobId, domain: row.blocked_domain, reason },
  };
}
