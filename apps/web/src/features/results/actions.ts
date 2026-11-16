"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/auth/schemas";
import { jobIdSchema } from "@/features/jobs/schemas";
import { getResultDetail } from "./queries";
import { metricPatch } from "./metadata";
import { reviewRows, type ReviewIntent } from "./review-input";

export type ReviewActionState = FormState & { intent?: ReviewIntent };

export async function reviewResultsAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  try {
    await requirePermission("results.view");
  } catch (error) {
    if (error instanceof AuthError)
      return { error: "You do not have permission to view results." };
    throw error;
  }
  const jobId = formData.get("job_id");
  if (typeof jobId !== "string" || !jobIdSchema.safeParse(jobId).success)
    return { error: "Invalid job. Reload and try again." };
  const parsed = reviewRows(formData);
  if ("error" in parsed) return parsed;
  try {
    await requirePermission(
      parsed.intent === "reopen" ? "results.reopen" : "results.review",
    );
  } catch (error) {
    if (error instanceof AuthError)
      return { error: "You do not have permission for that review action." };
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_opportunities", {
    p_job_id: jobId,
    p_rows: parsed.rows,
    p_action: parsed.intent,
    p_reason: parsed.reason,
    p_note: parsed.note,
  });
  if (error) {
    console.error("reviewResultsAction failed", error.message);
    return {
      error: error.message.includes("review_note_too_long")
        ? "The decision note would exceed 4,000 characters on a result. Shorten it and try again."
        : error.message.includes("review_scoring_missing")
          ? "A selected result needs a score and scoring details before a decision. Reload after scoring completes."
          : "Could not save the review decision. Reload and try again.",
    };
  }
  if (data === "stale")
    return {
      error:
        "Someone changed a selected result. Reload before saving your decision.",
    };
  if (data === "invalid_state")
    return {
      error: "A selected result changed status. Reload before trying again.",
    };
  if (data === "missing")
    return {
      error: "A selected result is no longer available. Reload the page.",
    };
  if (data === "queue_full")
    return {
      error:
        "The pending Ready queue is full. Finish a review before reopening this result.",
    };
  revalidatePath(`/jobs/${jobId}`);
  return {
    message: `${parsed.rows.length} result${parsed.rows.length === 1 ? "" : "s"} updated.`,
    intent: parsed.intent,
  };
}

export async function saveResultMetadataAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requirePermission("results.review");
  } catch (error) {
    if (error instanceof AuthError)
      return { error: "You do not have permission to edit this result." };
    throw error;
  }
  const jobId = formData.get("job_id");
  const id = formData.get("opportunity_id");
  const version = formData.get("row_version");
  const notes = formData.get("notes");
  if (
    typeof jobId !== "string" ||
    !jobIdSchema.safeParse(jobId).success ||
    typeof id !== "string" ||
    !jobIdSchema.safeParse(id).success ||
    typeof version !== "string" ||
    !/^\d+$/.test(version) ||
    !Number.isSafeInteger(Number(version)) ||
    typeof notes !== "string" ||
    notes.length > 4000
  )
    return { error: "Invalid review details. Reload and try again." };

  const detail = await getResultDetail(jobId, id);
  if (!detail)
    return { error: "This result is no longer available. Reload the page." };
  const patch = metricPatch(formData, detail.reviewerFields);
  if ("error" in patch) return patch;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_opportunity_metadata", {
    p_id: id,
    p_row_version: Number(version),
    p_notes: notes.trim() || null,
    p_metrics: patch.values,
  });
  if (error) {
    console.error("saveResultMetadataAction failed", error.message);
    return {
      error: "Could not save this result. Check your values and try again.",
    };
  }
  if (data === "stale")
    return {
      error: "Someone changed this result. Reload it before saving your edits.",
    };
  if (data === "missing")
    return { error: "This result is no longer available. Reload the page." };
  revalidatePath(`/jobs/${jobId}`);
  return { message: "Notes and metrics saved." };
}

export async function saveLinkPlacementAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requirePermission("results.review");
  } catch (error) {
    if (error instanceof AuthError)
      return { error: "You do not have permission to edit outreach." };
    throw error;
  }
  const jobId = formData.get("job_id");
  const id = formData.get("opportunity_id");
  const status = formData.get("outreach_status");
  const target = formData.get("target_url");
  const source = formData.get("source_url");
  const date = formData.get("placed_at");
  const version = formData.get("placement_version");
  if (
    typeof jobId !== "string" ||
    !jobIdSchema.safeParse(jobId).success ||
    typeof id !== "string" ||
    !jobIdSchema.safeParse(id).success ||
    typeof status !== "string" ||
    !["not_contacted", "contacted", "negotiating", "live", "closed"].includes(
      status,
    ) ||
    typeof target !== "string" ||
    target.length > 2048 ||
    typeof source !== "string" ||
    source.length > 2048 ||
    typeof date !== "string" ||
    (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    typeof version !== "string" ||
    !/^\d+$/.test(version) ||
    !Number.isSafeInteger(Number(version)) ||
    (status === "live" && (!target || !source || !date))
  )
    return { error: "Enter valid outreach details, then try again." };
  const detail = await getResultDetail(jobId, id);
  if (!detail) return { error: "This result is no longer available." };
  if (!(["approved", "used"] as string[]).includes(detail.review_status))
    return { error: "Approve this result before tracking outreach." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_link_placement", {
    p_opportunity_id: id,
    p_status: status,
    p_target_url: target.trim(),
    p_source_url: source.trim(),
    p_placed_at: date || null,
    p_version: Number(version),
  });
  if (error) {
    console.error("saveLinkPlacementAction failed", error.message);
    return { error: "Could not save outreach. Check URLs and try again." };
  }
  if (data === "stale")
    return { error: "Outreach changed. Reload before saving." };
  if (data !== "saved")
    return { error: "Could not save outreach. Reload and try again." };
  revalidatePath(`/jobs/${jobId}`);
  return { message: "Outreach saved." };
}
