"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { describeDbError } from "@/lib/db-errors";
import { CSV_BUCKET } from "../csv/limits";
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
  jobIdSchema,
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

  // The delete trigger persists a retry target before cascade removes upload rows.
  // Sweep the whole folder, including orphan uploads and validation reports.
  try {
    const admin = createAdminClient();
    const bucket = admin.storage.from(CSV_BUCKET);
    for (;;) {
      const { data: files, error: listError } = await bucket.list(job_id, {
        limit: 1000,
      });
      if (listError) throw listError;
      if (!files?.length) break;
      const { error: removeError } = await bucket.remove(
        files.map((file) => `${job_id}/${file.name}`),
      );
      if (removeError) throw removeError;
    }
    const { error: queueError } = await admin
      .from("job_storage_cleanup")
      .delete()
      .eq("job_id", job_id);
    if (queueError) throw queueError;
  } catch (cleanupError) {
    console.error("deleteJobAction: Storage cleanup queued", cleanupError);
    refresh();
    redirect("/jobs?saved=deleted_cleanup_pending");
  }

  refresh();
  redirect("/jobs?saved=deleted");
}

/** Confirmation and permission are enforced again by the database RPC. */
export async function rescoreJobAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await actor("jobs.rescore"))) return FORBIDDEN;
  const parsed = jobIdSchema.safeParse(formData.get("job_id"));
  if (!parsed.success) return { error: "Invalid job." };
  if (formData.get("confirmed") !== "yes") {
    return {
      error: "Confirm that you want to apply the current scoring settings.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_job_rescore", {
    p_job_id: parsed.data,
    p_confirmed: true,
  });
  if (error) {
    if (error.message.includes("rescore_requires_idle_finished_job")) {
      return {
        error:
          "Rescoring requires a completed or stopped job with no checks still running. Wait for workers to finish, then retry.",
      };
    }
    console.error("rescoreJobAction", error.code);
    return { error: "Could not request rescoring. Reload and try again." };
  }
  refresh(parsed.data);
  return {
    message:
      "Rescore queued using the current settings. Check Activity for completion.",
  };
}

/** Promote the highest-ranked backlog rows that fit the job's ready window. */
export async function releaseBacklogAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await actor("jobs.view"))) return FORBIDDEN;
  if (!(await actor("results.release_batch"))) return FORBIDDEN;
  const parsed = jobIdSchema.safeParse(formData.get("job_id"));
  if (!parsed.success) return { error: "Invalid job." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_backlog", {
    p_job_id: parsed.data,
  });
  if (error) {
    console.error("releaseBacklogAction", error.code);
    return {
      error: "Could not release backlog results. Reload and try again.",
    };
  }
  const count = typeof data === "number" ? data : 0;
  refresh(parsed.data);
  return {
    message:
      count > 0
        ? `Released ${count} ${count === 1 ? "result" : "results"} to Ready.`
        : "No backlog results fit in the current Ready queue.",
  };
}

/** Requeue one failed paid query. The RPC locks the job and enforces the budget. */
export async function retryJobQueryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await actor("jobs.control"))) return FORBIDDEN;
  const job = jobIdSchema.safeParse(formData.get("job_id"));
  const query = jobIdSchema.safeParse(formData.get("query_id"));
  if (!job.success || !query.success) return { error: "Invalid query." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("retry_job_query", {
    p_job_id: job.data,
    p_query_id: query.data,
  });
  if (error) {
    const reason: Record<string, string> = {
      query_not_failed: "This query has changed. Reload the page.",
      job_not_retryable: "This job cannot retry queries in its current state.",
      query_budget_reached: "No search credits remain in this job's budget.",
      job_not_found: "This job no longer exists.",
    };
    if (reason[error.message]) return { error: reason[error.message] };
    console.error("retryJobQueryAction", error.code);
    return { error: "Could not retry this query. Reload and try again." };
  }
  refresh(job.data);
  return {
    message:
      data === "reopened"
        ? "Query queued. Job reopened."
        : "Query queued for retry.",
  };
}
