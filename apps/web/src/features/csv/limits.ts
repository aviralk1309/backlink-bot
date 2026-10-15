/**
 * One place for the CSV limits. The bucket limit in
 * supabase/migrations/*_m4_csv_storage.sql must match MAX_CSV_BYTES, and the
 * worker enforces MAX_CSV_ROWS while it reads the file (M4-S3).
 */
export const CSV_BUCKET = "csv-uploads";
export const CSV_CONTENT_TYPE = "text/csv";

export const MAX_CSV_BYTES = 100 * 1024 * 1024; // 100 MiB
export const MAX_CSV_ROWS = 2_000_000;

/** Exports often arrive as .tsv or .txt. The worker detects the real delimiter. */
export const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;
