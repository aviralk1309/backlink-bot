import type { Json } from "@/lib/database.types";
import {
  FLAGS,
  QUEUES,
  REVIEW_STATUSES,
  SOURCES,
  TIERS,
  parseResultsParams,
  topReasons,
} from "./view";

export const EXPORT_COLUMNS = [
  ["normalized_url", "URL"],
  ["original_url", "Original URL"],
  ["domain", "Domain"],
  ["score", "Score"],
  ["tier", "Tier"],
  ["top_reasons", "Top reasons"],
  ["source_types", "Sources"],
  ["overlap_count", "Competitor overlap"],
  ["activity_key", "Activity"],
  ["review_status", "Review status"],
  ["reject_reason", "Reject reason"],
  ["notes", "Notes"],
  ["dr", "Domain rating"],
  ["traffic", "Monthly traffic"],
  ["external_metrics", "External metrics"],
  ["created_at", "Discovered at"],
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number][0];
export type ExportRow = {
  id: string;
  normalized_url: string;
  original_url: string;
  domain: string;
  score: number | null;
  tier: string | null;
  score_breakdown: Json | null;
  source_types: string[];
  overlap_count: number;
  activity_key: string | null;
  review_status: string;
  reject_reason: string | null;
  notes: string | null;
  external_metrics: Json;
  created_at: string;
};

const allowedColumns = new Set<string>(EXPORT_COLUMNS.map(([key]) => key));

export function parseExportForm(form: FormData) {
  const columns = form.getAll("column");
  if (
    columns.length === 0 ||
    columns.length > EXPORT_COLUMNS.length ||
    columns.some(
      (column) => typeof column !== "string" || !allowedColumns.has(column),
    ) ||
    new Set(columns).size !== columns.length
  )
    return null;

  const keys = [
    "queue",
    "tier",
    "activity",
    "source",
    "status",
    "domain",
    "q",
    "flag",
  ] as const;
  const raw: Record<string, string> = {};
  for (const key of keys) {
    const value = form.get(key);
    if (value !== null && typeof value !== "string") return null;
    raw[key] = value ?? "";
  }
  if (
    !QUEUES.includes(raw.queue as (typeof QUEUES)[number]) ||
    (raw.tier && !TIERS.includes(raw.tier as (typeof TIERS)[number])) ||
    (raw.source && !SOURCES.includes(raw.source as (typeof SOURCES)[number])) ||
    (raw.status &&
      !REVIEW_STATUSES.includes(
        raw.status as (typeof REVIEW_STATUSES)[number],
      )) ||
    (raw.flag && !FLAGS.includes(raw.flag as (typeof FLAGS)[number])) ||
    raw.activity.length > 100 ||
    raw.q.length > 100 ||
    raw.domain.length > 253
  )
    return null;
  const params = parseResultsParams(raw);
  if (raw.domain.trim() && !params.domain) return null;

  const chosen = form.get("export_status");
  if (
    typeof chosen !== "string" ||
    (chosen !== "current" &&
      !REVIEW_STATUSES.includes(chosen as (typeof REVIEW_STATUSES)[number]))
  )
    return null;
  if (chosen !== "current")
    return {
      columns: columns as ExportColumn[],
      params: {
        ...params,
        queue: "all" as const,
        tier: null,
        activity: null,
        source: null,
        status: chosen as (typeof REVIEW_STATUSES)[number],
        domain: null,
        q: null,
        flag: null,
      },
    };
  return { columns: columns as ExportColumn[], params };
}

export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe =
    /^[\s\x00]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n\x00]/u.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportHeader(columns: ExportColumn[]): string {
  const labels = new Map<string, string>(EXPORT_COLUMNS);
  return (
    columns.map((column) => csvCell(labels.get(column))).join(",") + "\r\n"
  );
}

export function exportLine(row: ExportRow, columns: ExportColumn[]): string {
  const metrics =
    row.external_metrics &&
    typeof row.external_metrics === "object" &&
    !Array.isArray(row.external_metrics)
      ? row.external_metrics
      : {};
  const value = (column: ExportColumn): unknown => {
    switch (column) {
      case "top_reasons":
        return topReasons(row.score_breakdown).join("; ");
      case "source_types":
        return row.source_types.join("; ");
      case "dr":
        return metrics.dr;
      case "traffic":
        return metrics.traffic;
      case "external_metrics":
        return JSON.stringify(metrics);
      default:
        return row[column];
    }
  };
  return columns.map((column) => csvCell(value(column))).join(",") + "\r\n";
}

export async function* exportChunks(
  first: ExportRow[],
  columns: ExportColumn[],
  batchSize: number,
  next: (after: string) => Promise<ExportRow[]>,
) {
  yield exportHeader(columns);
  let rows = first;
  while (rows.length) {
    yield rows.map((row) => exportLine(row, columns)).join("");
    if (rows.length < batchSize) return;
    rows = await next(rows[rows.length - 1].id);
  }
}
