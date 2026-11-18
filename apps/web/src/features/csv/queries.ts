import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CSV_BUCKET, CSV_SAMPLE_BYTES } from "./limits";
import { csvStoragePath } from "./rules";
import { decodeCsvSample } from "./sample";
import { csvMappingSchema } from "./schemas";
import type {
  CsvFileInfo,
  CsvSample,
  CsvUploadForMapping,
  CsvUploadItem,
  CsvUploadKind,
  CsvUploadSummary,
  GapDomainItem,
  GapPreviewSummary,
  MappingTemplateItem,
} from "./types";

const COLUMNS =
  "id, job_id, kind, competitor_label, filename, storage_path, size_bytes, status, status_reason, total_rows, valid_rows, invalid_rows, empty_rows, duplicate_rows, error_report_path, created_at, confirmed_at";

const MAPPING_COLUMNS = `${COLUMNS}, mapping, template_id, file_info`;

/**
 * Every upload of a job, newest first, discarded ones included (history, I3).
 * Runs as the signed-in user, so RLS (jobs.view) decides what shows.
 */
export async function listCsvUploads(jobId: string): Promise<CsvUploadItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("csv_uploads")
    .select(COLUMNS)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(`listCsvUploads failed: ${error.message}`);
  return (data ?? []) as unknown as CsvUploadItem[];
}

export async function countPendingCsvCleanup(jobId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("csv_storage_cleanup")
    .select("*", { count: "exact", head: true })
    .eq("job_id", jobId);
  if (error) throw new Error(`countPendingCsvCleanup failed: ${error.message}`);
  return count ?? 0;
}

/** One upload with its saved mapping. Null when RLS hides it or it is not in this job. */
export async function getCsvUploadForMapping(
  jobId: string,
  uploadId: string,
): Promise<CsvUploadForMapping | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("csv_uploads")
    .select(MAPPING_COLUMNS)
    .eq("id", uploadId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw new Error(`getCsvUploadForMapping failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as CsvUploadItem & {
    mapping: unknown;
    template_id: string | null;
    file_info: unknown;
  };
  const mapping = csvMappingSchema.safeParse(row.mapping);
  const info =
    row.file_info &&
    typeof row.file_info === "object" &&
    !Array.isArray(row.file_info)
      ? (row.file_info as CsvFileInfo)
      : {};
  return {
    ...row,
    mapping: mapping.success ? mapping.data : null,
    template_id: row.template_id,
    file_info: info,
  };
}

/**
 * Reads only the first CSV_SAMPLE_BYTES of the file. Never downloads the whole
 * object (limit is 100 MB). Uses a short signed URL created under the user's own
 * session, so storage RLS (csv.upload) decides. If the server ignores Range and
 * answers 200, the stream is cut and cancelled at the limit.
 */
export async function getCsvUploadSample(
  upload: Pick<CsvUploadItem, "id" | "job_id" | "size_bytes"> & {
    storage_path?: string;
  },
): Promise<CsvSample> {
  const supabase = await createClient();
  const path = upload.storage_path || csvStoragePath(upload.job_id, upload.id);
  const { data, error } = await supabase.storage
    .from(CSV_BUCKET)
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, reason: "not_found" };

  let bytes: Uint8Array;
  try {
    const res = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${CSV_SAMPLE_BYTES - 1}` },
      cache: "no-store",
    });
    if (!res.ok || !res.body) return { ok: false, reason: "unreadable" };
    bytes = await readUpTo(res.body, CSV_SAMPLE_BYTES);
  } catch (err) {
    console.error("getCsvUploadSample: fetch failed", err);
    return { ok: false, reason: "unreadable" };
  }

  const truncated = upload.size_bytes > bytes.length;
  const decoded = decodeCsvSample(bytes, truncated);
  return { ok: true, truncated, ...decoded };
}

async function readUpTo(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - offset);
    if (take <= 0) break;
    out.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

/** Templates for one file kind. RLS hides unshared templates of other people. */
export async function listMappingTemplates(
  kind: CsvUploadKind,
): Promise<MappingTemplateItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mapping_templates")
    .select("id, name, kind, mapping, shared, created_by, created_at")
    .eq("kind", kind)
    .order("name", { ascending: true });
  if (error) throw new Error(`listMappingTemplates failed: ${error.message}`);

  const items: MappingTemplateItem[] = [];
  for (const row of data ?? []) {
    const mapping = csvMappingSchema.safeParse(row.mapping);
    if (!mapping.success) {
      console.warn("listMappingTemplates: skipped malformed template", row.id);
      continue;
    }
    items.push({
      ...(row as unknown as MappingTemplateItem),
      mapping: mapping.data,
    });
  }
  return items;
}

/** Fetches full validation summary, error breakdown, and sample error rows for an upload. */
export async function getCsvUploadSummary(
  jobId: string,
  uploadId: string,
): Promise<CsvUploadSummary | null> {
  const supabase = await createClient();

  const { data: upload, error: uploadErr } = await supabase
    .from("csv_uploads")
    .select(COLUMNS)
    .eq("id", uploadId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (uploadErr || !upload) return null;

  // Fetch breakdown of invalid reasons via RPC
  const { data: errorCounts, error: countErr } = await supabase.rpc(
    "get_csv_upload_error_counts",
    { p_upload_id: uploadId },
  );
  if (countErr) {
    console.warn("getCsvUploadSummary: error counts failed", countErr.message);
  }

  // Fetch sample error rows (up to 20)
  const { data: sampleRows, error: sampleErr } = await supabase
    .from("csv_rows")
    .select("row_no, raw_url, error_code")
    .eq("upload_id", uploadId)
    .eq("is_valid", false)
    .order("row_no", { ascending: true })
    .limit(20);

  if (sampleErr) {
    console.warn("getCsvUploadSummary: sample rows failed", sampleErr.message);
  }

  return {
    upload: upload as unknown as CsvUploadSummary["upload"],
    errorsByReason: (errorCounts ?? []).map(
      (ec: { error_code: string; count: number | string }) => ({
        error_code: ec.error_code,
        count: Number(ec.count),
      }),
    ),
    sampleErrors: (sampleRows ?? []).map((r) => ({
      row_no: r.row_no,
      raw_url: r.raw_url,
      error_code: r.error_code,
    })),
  };
}

/** Computes the domain-level competitor gap with overlap counts (M4-S6). */
export async function getJobGapDomains(
  jobId: string,
): Promise<GapDomainItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_job_gap_domains", {
    p_job_id: jobId,
  });
  if (error) {
    console.error("getJobGapDomains failed", error.message);
    throw new Error(`getJobGapDomains failed: ${error.message}`);
  }
  return (data ?? []) as GapDomainItem[];
}

/** Pre-start gap preview: total domains, overlap distribution, client file status (M4-S6). */
export async function getJobGapPreview(
  jobId: string,
): Promise<GapPreviewSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_job_gap_preview", {
    p_job_id: jobId,
  });
  if (error) {
    console.error("getJobGapPreview failed", error.message);
    return null;
  }
  const row = data?.[0];
  if (!row) {
    return {
      total_gap_domains: 0,
      has_client_file: false,
      client_link_status: "unknown",
      overlap_distribution: {},
    };
  }
  return {
    total_gap_domains: Number(row.total_gap_domains ?? 0),
    has_client_file: Boolean(row.has_client_file),
    client_link_status: row.client_link_status as "unknown" | "known_partial",
    overlap_distribution: (row.overlap_distribution ?? {}) as Record<
      string,
      number
    >,
  };
}
