"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { describeDbError } from "@/lib/db-errors";
import { TRANSITION_NOTICE } from "./notice";
import {
  describeStartProblems,
  isDeletable,
  isEditable,
  parseStartProblems,
  permissionForAction,
  planJobSave,
  planTransition,
} from "./rules";
import {
  deleteJobSchema,
  jobFormInput,
  saveJobSchema,
  transitionJobSchema,
} from "./schemas";
import type { ActivityOption, JobStatus } from "./types";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
};
const GONE: FormState = {
  error: "That job no longer exists. Reload the page.",
};
const STALE: FormState = {
  error:
    "Someone else changed this job while you were editing. Reload the page to see their changes, then make yours again.",
};

/** What saveJobAction reads about the job it is about to change. */
type PreviousJob = {
  id: string;
  status: JobStatus;
  activity_keys: string[];
};

/** First line of every action here: the caller must hold the permission. */
async function actor(permission: string) {
  try {
    return await requirePermission(permission);
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
}

function refresh(jobId?: string) {
  revalidatePath("/jobs");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/**
 * Creates a job (jobs.create) or saves one (jobs.edit). Runs under the
 * caller's own session, so RLS and the column grants are the real gate.
 * Status and config_version are never sent: only the lifecycle functions
 * and the versioning trigger may change them.
 */
export async function saveJobAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const rawId = formData.get("job_id");
  const editing = typeof rawId === "string" && rawId !== "";

  const session = await actor(editing ? "jobs.edit" : "jobs.create");
  if (!session) return FORBIDDEN;

  const parsed = saveJobSchema.safeParse(jobFormInput(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id, seen_updated_at, ...values } = parsed.data;

  const supabase = await createClient();

  // Never trust the client for status or activity history: read it fresh.
  let previous: PreviousJob | null = null;
  if (job_id) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, activity_keys")
      .eq("id", job_id)
      .maybeSingle();
    if (error) {
      console.error("saveJobAction: read failed", error.message);
      return { error: describeDbError(error.message) };
    }
    if (!data) return GONE;
    previous = data as unknown as PreviousJob;
    if (!isEditable(previous.status)) {
      return {
        error:
          "This job is finished, so its settings can no longer be changed.",
      };
    }
  }

  const { data: activities, error: activitiesError } = await supabase
    .from("activity_profiles")
    .select("key, name, enabled");
  if (activitiesError) {
    console.error("saveJobAction: activities failed", activitiesError.message);
    return { error: describeDbError(activitiesError.message) };
  }

  const plan = planJobSave({
    previousActivityKeys: previous?.activity_keys ?? null,
    activityKeys: values.activity_keys,
    activities: (activities ?? []) as ActivityOption[],
  });
  if (!plan.ok) return { error: plan.error };

  let savedId: string;
  if (previous) {
    // The updated_at match turns a lost update into a clear message.
    const { data: updated, error } = await supabase
      .from("jobs")
      .update(values)
      .eq("id", previous.id)
      .eq("updated_at", seen_updated_at as string)
      .select("id");
    if (error) {
      console.error("saveJobAction: update failed", error.message);
      return { error: describeDbError(error.message) };
    }
    if (!updated?.length) return STALE;
    savedId = previous.id;
  } else {
    const { data: created, error } = await supabase
      .from("jobs")
      .insert(values)
      .select("id")
      .single();
    if (error) {
      console.error("saveJobAction: insert failed", error.message);
      return { error: describeDbError(error.message) };
    }
    savedId = (created as { id: string }).id;
  }

  refresh(savedId);
  redirect(`/jobs/${savedId}?saved=${previous ? "updated" : "created"}`);
}

/**
 * Start (jobs.start), pause, resume and stop (jobs.control). The database
 * function transition_job checks the permission and the state machine again.
 */
export async function jobTransitionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = transitionJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id, action, reason, confirm } = parsed.data;

  const session = await actor(permissionForAction(action));
  if (!session) return FORBIDDEN;

  const supabase = await createClient();
  const { data: job, error: readError } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", job_id)
    .maybeSingle();
  if (readError) {
    console.error("jobTransitionAction: read failed", readError.message);
    return { error: describeDbError(readError.message) };
  }
  if (!job) return GONE;

  const plan = planTransition({
    status: (job as { status: JobStatus }).status,
    action,
    confirm: confirm === "yes",
  });
  if (!plan.ok) return { error: plan.error };

  const { error } = await supabase.rpc("transition_job", {
    p_job_id: job_id,
    p_action: action,
    p_reason: reason,
  });
  if (error) {
    console.error("jobTransitionAction: transition failed", error.message);
    const problems = parseStartProblems(error.message);
    if (problems.length > 0) return { error: describeStartProblems(problems) };
    return { error: describeDbError(error.message) };
  }

  refresh(job_id);
  return { message: TRANSITION_NOTICE[action] };
}

/** Deletes a job (jobs.delete). Queued and running jobs must be stopped first. */
export async function deleteJobAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await actor("jobs.delete");
  if (!session) return FORBIDDEN;

  const parsed = deleteJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id } = parsed.data;

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", job_id)
    .maybeSingle();
  if (!job) return GONE;
  if (!isDeletable((job as { status: JobStatus }).status)) {
    return {
      error: "Stop this job before deleting it. Workers may still be using it.",
    };
  }

  // RLS also refuses queued and running jobs, so a race ends here.
  const { data: deleted, error } = await supabase
    .from("jobs")
    .delete()
    .eq("id", job_id)
    .select("id");
  if (error) {
    console.error("deleteJobAction: delete failed", error.message);
    return { error: describeDbError(error.message) };
  }
  if (!deleted?.length) return FORBIDDEN;

  refresh();
  redirect("/jobs?saved=deleted");
}
