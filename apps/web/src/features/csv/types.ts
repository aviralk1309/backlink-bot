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
  storage_path: string;
  size_bytes: number;
  status: CsvUploadStatus;
  status_reason: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  empty_rows: number;
  duplicate_rows: number;
  error_report_path: string | null;
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

// ---------------------------------------------------------------------------
// Column mapping (M4-S4)
// ---------------------------------------------------------------------------

export type ColumnType = "text" | "number" | "date" | "ignore";

export const COLUMN_TYPES: readonly ColumnType[] = [
  "text",
  "number",
  "date",
  "ignore",
] as const;

export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  ignore: "Ignore",
};

/** One non-URL column in the mapping. */
export type ColumnMapping = {
  index: number;
  /** Original header text from the file. */
  source: string;
  /** User-chosen display label (defaults to source). */
  label: string;
  type: ColumnType;
};

/**
 * The mapping jsonb saved on csv_uploads and mapping_templates.
 * Contract documented in migration 20261015024143_m4_csv_schema.sql, lines 24-29.
 */
export type CsvMapping = {
  url_index: number;
  url_column: string;
  columns: ColumnMapping[];
};

/** A saved mapping template from the mapping_templates table. */
export type MappingTemplateItem = {
  id: string;
  name: string;
  kind: CsvUploadKind;
  mapping: CsvMapping;
  shared: boolean;
  created_by: string | null;
  created_at: string;
};

/** Worker findings. Empty object until the file is analyzed (data dictionary). */
export type CsvFileInfo = {
  encoding?: string;
  bom?: boolean;
  delimiter?: string;
  header_line?: number | null;
  headers?: string[];
  looks_like_data?: boolean;
};

export type CsvUploadForMapping = CsvUploadItem & {
  mapping: CsvMapping | null;
  template_id: string | null;
  file_info: CsvFileInfo;
};

export type CsvMappingPreview = {
  sampleText: string;
  delimiter?: string;
  headerLine?: number | null;
  detectedHeaders?: string[];
  existingMapping: CsvMapping | null;
  templates: MappingTemplateItem[];
};

export type CsvSample =
  | {
      ok: true;
      text: string;
      /** True when the file is bigger than the sample. The last record may be cut. */
      truncated: boolean;
      encoding: string;
      bom: boolean;
    }
  | { ok: false; reason: "not_found" | "unreadable" };

export type CsvErrorSample = {
  row_no: number;
  raw_url: string;
  error_code: string | null;
};

export type CsvErrorCount = {
  error_code: string;
  count: number;
};

export type CsvUploadSummary = {
  upload: CsvUploadItem & { error_report_path: string | null };
  errorsByReason: CsvErrorCount[];
  sampleErrors: CsvErrorSample[];
};

export const ERROR_CODE_LABEL: Record<string, string> = {
  empty_row: "Empty line",
  bad_url: "Invalid URL",
  not_http: "Non-HTTP protocol",
  too_long: "URL exceeds length limit",
};

// ---------------------------------------------------------------------------
// Competitor Gap (M4-S6)
// ---------------------------------------------------------------------------

export type ClientLinkStatus = "unknown" | "known_partial";

export type GapDomainItem = {
  domain: string;
  overlap_count: number;
  client_link_status: ClientLinkStatus;
  competitor_labels: string[];
};

export type GapPreviewSummary = {
  total_gap_domains: number;
  has_client_file: boolean;
  client_link_status: ClientLinkStatus;
  overlap_distribution: Record<string, number>;
};
