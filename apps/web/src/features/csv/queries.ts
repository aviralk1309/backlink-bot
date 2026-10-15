import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CsvUploadItem } from "./types";

const COLUMNS =
  "id, job_id, kind, competitor_label, filename, size_bytes, status, status_reason, total_rows, valid_rows, invalid_rows, empty_rows, duplicate_rows, created_at, confirmed_at";

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
