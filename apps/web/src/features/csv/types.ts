export type CsvUploadStatus =
  | "uploaded"
  | "mapped"
  | "processing"
  | "ready"
  | "confirmed"
  | "failed"
  | "discarded";

export type CsvUploadKind = "competitor" | "client";

export type CsvUploadItem = {
  id: string;
  job_id: string;
  kind: CsvUploadKind;
  competitor_label: string | null;
  filename: string;
  size_bytes: number;
  status: CsvUploadStatus;
  status_reason: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  empty_rows: number;
  duplicate_rows: number;
  created_at: string;
  confirmed_at: string | null;
};

export const CSV_STATUS_LABEL: Record<CsvUploadStatus, string> = {
  uploaded: "Needs mapping",
  mapped: "Waiting to be read",
  processing: "Reading",
  ready: "Ready to confirm",
  confirmed: "Confirmed",
  failed: "Failed",
  discarded: "Discarded",
};
