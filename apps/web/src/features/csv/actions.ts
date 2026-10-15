"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { describeDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { CSV_BUCKET, MAX_CSV_BYTES } from "./limits";
import { csvStoragePath, normalizeCompetitorLabel } from "./rules";
import { discardUploadSchema, registerUploadSchema } from "./schemas";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
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

/**
 * Step 2 of an upload. The browser has already put the file in Storage under
 * the user's own session (storage RLS checked csv.upload, the path and that
 * the job is a Draft). Here we confirm the file is really there, take its size
 * from Storage (never from the client) and create the csv_uploads row.
 */
export async function registerCsvUploadAction(
  formData: FormData,
): Promise<FormState> {
  const session = await actor("csv.upload");
  if (!session) return FORBIDDEN;

  const parsed = registerUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id, upload_id, kind, competitor, filename } = parsed.data;

  let label: string | null = null;
  if (kind === "competitor") {
    label = normalizeCompetitorLabel(competitor);
    if (!label) {
      return { error: "Enter the competitor's website, like example.com." };
    }
  }

  const supabase = await createClient();
  const objectName = `${upload_id}.csv`;
  const { data: files, error: listError } = await supabase.storage
    .from(CSV_BUCKET)
    .list(job_id, { limit: 1, search: objectName });
  if (listError) {
    console.error("registerCsvUploadAction: list failed", listError.message);
    return { error: "Could not check the uploaded file. Try again." };
  }
  const object = files?.find((f) => f.name === objectName);
  if (!object) {
    return {
      error: "The upload did not finish. Choose the file and try again.",
    };
  }

  const size = Number(object.metadata?.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { error: "That file is empty." };
  }
  if (size > MAX_CSV_BYTES) {
    return { error: "That file is over the size limit." };
  }

  const { error } = await supabase.from("csv_uploads").insert({
    job_id,
    kind,
    competitor_label: label,
    filename,
    storage_path: csvStoragePath(job_id, upload_id),
    size_bytes: size,
  });
  if (error) {
    console.error("registerCsvUploadAction: insert failed", error.message);
    if (error.code === "23505") {
      return {
        error: label
          ? `A file for ${label} is already in this job. Discard it first, then upload again.`
          : "That file was already added.",
      };
    }
    if (error.code === "42501") {
      return { error: "Files can only be added while the job is a Draft." };
    }
    return { error: describeDbError(error.message) };
  }

  revalidatePath(`/jobs/${job_id}`);
  return { message: "File uploaded." };
}

/** Discards a file (csv.upload). The database function re-checks everything. */
export async function discardCsvUploadAction(
  formData: FormData,
): Promise<FormState> {
  const session = await actor("csv.upload");
  if (!session) return FORBIDDEN;

  const parsed = discardUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id, upload_id } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_csv_upload", {
    p_upload_id: upload_id,
  });
  if (error) {
    console.error("discardCsvUploadAction: failed", error.message);
    if (error.message.includes("upload_processing")) {
      return {
        error: "This file is being read right now. Try again in a minute.",
      };
    }
    if (error.message.includes("job_not_draft")) {
      return { error: "Files can only be changed while the job is a Draft." };
    }
    if (error.message.includes("upload_not_found")) {
      return { error: "That file no longer exists. Reload the page." };
    }
    return { error: describeDbError(error.message) };
  }

  revalidatePath(`/jobs/${job_id}`);
  return { message: "File discarded." };
}
