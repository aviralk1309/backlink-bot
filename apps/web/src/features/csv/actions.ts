"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { firstIssue, type FormState } from "@/lib/auth/schemas";
import { describeDbError } from "@/lib/db-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CSV_BUCKET, MAX_CSV_BYTES } from "./limits";
import {
  getCsvUploadForMapping,
  getCsvUploadSample,
  listMappingTemplates,
} from "./queries";
import {
  csvStoragePath,
  competitorFilenameMismatch,
  normalizeCompetitorLabel,
  validateMapping,
} from "./rules";
import {
  confirmUploadSchema,
  deleteUploadSchema,
  discardUploadSchema,
  registerUploadSchema,
  saveMappingSchema,
} from "./schemas";
import type { CsvMapping, CsvMappingPreview, CsvUploadKind } from "./types";
import type { Json } from "@/lib/database.types";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
};

const TEMPLATE_FORBIDDEN: FormState = {
  error: "You can save the mapping, but not templates.",
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

/** Load the bounded preview only when a reviewer opens Map columns. */
export async function loadCsvMappingPreviewAction(
  jobId: string,
  uploadId: string,
): Promise<{ data: CsvMappingPreview } | { error: string }> {
  const session = await actor("csv.upload");
  if (!session) return { error: "You do not have permission to do that." };
  const parsed = deleteUploadSchema.safeParse({
    job_id: jobId,
    upload_id: uploadId,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const upload = await getCsvUploadForMapping(jobId, uploadId);
  if (!upload || !["uploaded", "mapped"].includes(upload.status)) {
    return { error: "This file can no longer be mapped. Refresh the page." };
  }
  const [sample, templates] = await Promise.all([
    getCsvUploadSample(upload),
    listMappingTemplates(upload.kind),
  ]);
  if (!sample.ok)
    return { error: "Could not read the file preview. Try again." };
  return {
    data: {
      sampleText: sample.text,
      delimiter: upload.file_info.delimiter,
      headerLine: upload.file_info.header_line,
      detectedHeaders: upload.file_info.headers,
      existingMapping: upload.mapping,
      templates,
    },
  };
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
    const mismatch = competitorFilenameMismatch(filename, label);
    if (mismatch) return { error: mismatch };
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

  // Re-upload replaces the previous active file of the same label (M4-S5)
  if (kind === "competitor" && label) {
    const { data: existing } = await supabase
      .from("csv_uploads")
      .select("id")
      .eq("job_id", job_id)
      .eq("kind", "competitor")
      .eq("competitor_label", label)
      .not("status", "in", '("failed","discarded")')
      .maybeSingle();

    if (existing) {
      const { error: discardErr } = await supabase.rpc("discard_csv_upload", {
        p_upload_id: existing.id,
      });
      if (discardErr) {
        if (discardErr.message.includes("upload_processing")) {
          return {
            error: `A file for ${label} is currently being read. Try again in a minute.`,
          };
        }
        return { error: describeDbError(discardErr.message) };
      }
    }
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

/** Confirms a validated upload (csv.upload). */
export async function confirmCsvUploadAction(
  formData: FormData,
): Promise<FormState> {
  const session = await actor("csv.upload");
  if (!session) return FORBIDDEN;

  const parsed = confirmUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id, upload_id } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_csv_upload", {
    p_upload_id: upload_id,
  });
  if (error) {
    console.error("confirmCsvUploadAction: failed", error.message);
    if (error.message.includes("upload_no_usable_rows")) {
      return {
        error: "This file has no usable rows. Fix the CSV and upload it again.",
      };
    }
    if (error.message.includes("upload_not_ready")) {
      return {
        error:
          "This file has not finished validating yet. Try again in a moment.",
      };
    }
    if (error.message.includes("job_not_draft")) {
      return { error: "Files can only be confirmed while the job is a Draft." };
    }
    if (error.message.includes("upload_not_found")) {
      return { error: "That file no longer exists. Reload the page." };
    }
    return { error: describeDbError(error.message) };
  }

  revalidatePath(`/jobs/${job_id}`);
  return { message: "File confirmed." };
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

/** Deletes a file completely from DB and storage (csv.upload). */
export async function deleteCsvUploadAction(
  formData: FormData,
): Promise<FormState> {
  const session = await actor("csv.upload");
  if (!session) return FORBIDDEN;

  const parsed = deleteUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { job_id, upload_id } = parsed.data;

  const supabase = await createClient();
  const { data: storagePath, error } = await supabase.rpc("delete_csv_upload", {
    p_upload_id: upload_id,
  });
  if (error) {
    console.error("deleteCsvUploadAction: failed", error.message);
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

  // The DB trigger persists both the CSV and error-report paths for retry.
  if (storagePath) {
    try {
      const admin = createAdminClient();
      const { error: removeError } = await admin.storage
        .from(CSV_BUCKET)
        .remove([storagePath]);
      if (removeError) throw removeError;
      const { error: ackError } = await admin
        .from("csv_storage_cleanup")
        .delete()
        .eq("path", storagePath);
      if (ackError) throw ackError;
    } catch (cleanupError) {
      console.error(
        "deleteCsvUploadAction: Storage cleanup pending",
        cleanupError,
      );
    }
  }

  const { data: pending, error: pendingError } = await supabase
    .from("csv_storage_cleanup")
    .select("path")
    .eq("upload_id", upload_id)
    .limit(1);
  revalidatePath(`/jobs/${job_id}`);
  return {
    message:
      pendingError || pending?.length
        ? "File removed from job. Storage cleanup pending; reload to check progress."
        : "File deleted.",
  };
}

function describeSaveMappingError(error: {
  message: string;
  code?: string;
}): string {
  const m = error.message;
  if (m.includes("job_not_draft"))
    return "Files can only be changed while the job is a Draft.";
  if (m.includes("upload_not_found"))
    return "That file no longer exists. Reload the page.";
  if (m.includes("got processing"))
    return "This file is being read right now. Try again in a minute.";
  if (m.includes("upload_status_invalid")) {
    return "This file can no longer be re-mapped. Discard it and upload it again.";
  }
  if (m.includes("mapping_"))
    return "The mapping is not valid. Reload the page and try again.";
  if (error.code === "42501") return "You do not have permission to do that.";
  if (error.code === "23503") return "That template no longer exists.";
  return describeDbError(m);
}

/**
 * Saves the column mapping (csv.upload) through save_csv_mapping, which owns the
 * status change. Takes a typed object, not FormData, because the payload has
 * arrays. Input is untrusted: zod and validateMapping run first.
 * "Save as template" needs mapping_templates.manage. The template is created
 * FIRST so a name clash shows up before anything is saved. If the RPC then
 * fails, the new template is removed again (best effort).
 */
export async function saveCsvMappingAction(input: unknown): Promise<FormState> {
  const session = await actor("csv.upload");
  if (!session) return FORBIDDEN;

  const parsed = saveMappingSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  const mapping: CsvMapping = {
    url_index: d.url_index,
    url_column: d.url_column,
    columns: d.columns,
  };
  const problem = validateMapping(mapping);
  if (problem) return { error: problem };

  if (d.save_as_template && !(await actor("mapping_templates.manage"))) {
    return TEMPLATE_FORBIDDEN;
  }

  const supabase = await createClient();

  const { data: upload, error: uploadError } = await supabase
    .from("csv_uploads")
    .select("kind, job_id")
    .eq("id", d.upload_id)
    .maybeSingle();
  if (uploadError) {
    console.error(
      "saveCsvMappingAction: upload lookup failed",
      uploadError.message,
    );
    return { error: describeDbError(uploadError.message) };
  }
  if (!upload || upload.job_id !== d.job_id) {
    return { error: "That file no longer exists. Reload the page." };
  }
  const kind = upload.kind as CsvUploadKind;

  let templateId: string | null = d.template_id ?? null;
  let createdTemplateId: string | null = null;

  if (d.save_as_template) {
    // DEFAULT-ASSUMED: new templates are shared with the whole team.
    const { data: tpl, error } = await supabase
      .from("mapping_templates")
      .insert({
        name: d.template_name,
        kind,
        mapping: mapping as unknown as Json,
        shared: true,
      })
      .select("id")
      .single();
    if (error) {
      console.error(
        "saveCsvMappingAction: template insert failed",
        error.message,
      );
      if (error.code === "23505") {
        return {
          error: `A ${kind} template called "${d.template_name}" already exists. Choose another name.`,
        };
      }
      if (error.code === "42501") return TEMPLATE_FORBIDDEN;
      return { error: describeDbError(error.message) };
    }
    templateId = tpl.id;
    createdTemplateId = tpl.id;
  } else if (templateId) {
    const { data: tpl } = await supabase
      .from("mapping_templates")
      .select("kind")
      .eq("id", templateId)
      .maybeSingle();
    if (!tpl) return { error: "That template no longer exists." };
    if (tpl.kind !== kind)
      return { error: `That template is for ${tpl.kind} files.` };
  }

  const { error } = await supabase.rpc("save_csv_mapping", {
    p_upload_id: d.upload_id,
    p_mapping: mapping as unknown as Json,
    p_template_id: templateId ?? undefined,
  });
  if (error) {
    console.error("saveCsvMappingAction: rpc failed", error.message);
    if (createdTemplateId) {
      await supabase
        .from("mapping_templates")
        .delete()
        .eq("id", createdTemplateId);
    }
    return { error: describeSaveMappingError(error) };
  }

  revalidatePath(`/jobs/${d.job_id}`);
  return {
    message: createdTemplateId
      ? "Mapping and template saved."
      : "Mapping saved.",
  };
}
