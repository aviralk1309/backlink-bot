import { getDomain } from "tldts";
import { ACCEPTED_EXTENSIONS, MAX_CSV_BYTES } from "./limits";
import type { ColumnMapping, ColumnType, CsvMapping } from "./types";

/** Same shape as the csv_uploads_label_format check and blocklist.domain. */
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$/;

/**
 * Turns what a person typed ("https://www.Rival.com/blog", "rival.com") into
 * the competitor's registered domain ("rival.com"), or null when it is not a
 * real site. Counting distinct competitors (G10) relies on this being stable.
 * Public suffix data comes from tldts (ICANN section only), which may differ
 * slightly from the worker's library on very new suffixes.
 */
export function normalizeCompetitorLabel(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let host: string;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    // URL lowercases the host and converts it to punycode.
    host = new URL(hasScheme ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }

  const domain = getDomain(host);
  return domain && LABEL_PATTERN.test(domain) ? domain : null;
}

/** Common backlink exports name the source site before "-backlinks". */
export function competitorFilenameMismatch(
  filename: string,
  competitor: string,
): string | null {
  const source = /^(.+?)-backlinks(?:[-_.]|$)/i.exec(filename);
  const domain = source ? normalizeCompetitorLabel(source[1]) : null;
  return domain && domain !== competitor
    ? `This file appears to be for ${domain}, but the competitor is ${competitor}. Change the competitor website or choose the correct file.`
    : null;
}

/** Storage object name. Must match the regex in the storage insert policy. */
export function csvStoragePath(jobId: string, uploadId: string): string {
  return `${jobId}/${uploadId}.csv`;
}

/** First problem with the chosen file, in plain words, or null when fine. */
export function checkCsvFile(file: {
  name: string;
  size: number;
}): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "Choose a .csv, .tsv or .txt file.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_CSV_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_CSV_BYTES)}.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Mapping auto-guess and template matching (M4-S4)
// ---------------------------------------------------------------------------

/**
 * Header names that strongly indicate a URL column.
 * Lowercase, checked against the lowered + trimmed header.
 * Patterns come from Ahrefs, Semrush, GSC and generic exports.
 */
const URL_HEADER_NAMES: readonly string[] = [
  "url",
  "target url",
  "target",
  "source url",
  "source page",
  "referring page",
  "referring url",
  "page url",
  "page",
  "link url",
  "link",
  "address",
  "backlink",
  "referring page url",
  "source page url",
  "top pages",
];

/** Prefixes that indicate the *content* is a URL, not the header name. */
const URL_PREFIXES = ["http://", "https://", "//", "www."] as const;

/**
 * Given headers (display labels from the file), return the 0-based index of
 * the best URL-column guess, or -1 if nothing matches. The mapping screen
 * pre-selects this but the user can override.
 *
 * Priority: exact header name match > header contains "url" > first column
 * whose sample values look like URLs (not checked here — pass previewRow
 * for that).
 */
export function guessUrlColumn(
  headers: readonly string[],
  previewRow?: readonly string[],
): number {
  if (headers.length === 0) return -1;

  // Pass 1: exact (lowered) match against known URL headers
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (URL_HEADER_NAMES.includes(h)) return i;
  }

  // Pass 2: header contains "url" anywhere
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase().includes("url")) return i;
  }

  // Pass 3: first column whose sample value looks like a URL
  if (previewRow) {
    for (let i = 0; i < previewRow.length; i++) {
      const v = previewRow[i]?.trim().toLowerCase() ?? "";
      if (URL_PREFIXES.some((p) => v.startsWith(p))) return i;
    }
  }

  return -1;
}

/**
 * How well a template's header set matches the current file's headers.
 * Returns a ratio 0..1 (1 = perfect match). Used to auto-suggest the best
 * template. A score ≥ 0.6 is a reasonable "auto-suggest" threshold.
 */
export function templateHeaderScore(
  templateColumns: readonly { source: string }[],
  templateUrlColumn: string,
  fileHeaders: readonly string[],
): number {
  if (fileHeaders.length === 0) return 0;

  const fileSet = new Set(fileHeaders.map((h) => h.trim().toLowerCase()));
  const templateHeaders = [
    templateUrlColumn,
    ...templateColumns.map((c) => c.source),
  ].map((h) => h.trim().toLowerCase());

  if (templateHeaders.length === 0) return 0;

  let matches = 0;
  for (const th of templateHeaders) {
    if (fileSet.has(th)) matches++;
  }
  return matches / Math.max(templateHeaders.length, fileHeaders.length);
}

/**
 * Resolves a saved mapping template onto a target file's headers.
 * Matches URL column and other columns by header name (case-insensitive / trimmed).
 * If columns were reordered or new columns exist in the file, this accurately
 * resolves the target file's column indexes.
 */
export function applyMappingTemplate(
  templateMapping: CsvMapping,
  targetHeaders: readonly string[],
  previewRow?: readonly string[],
): {
  urlIndex: number;
  columns: ColumnMapping[];
} {
  const norm = (s: string) => s.trim().toLowerCase();
  const templateTargetUrlNorm = norm(templateMapping.url_column);

  // 1. Resolve URL column
  let resolvedUrlIndex = -1;
  if (templateTargetUrlNorm) {
    resolvedUrlIndex = targetHeaders.findIndex(
      (h) => norm(h) === templateTargetUrlNorm,
    );
  }
  if (resolvedUrlIndex === -1) {
    if (
      templateMapping.url_index >= 0 &&
      templateMapping.url_index < targetHeaders.length
    ) {
      resolvedUrlIndex = templateMapping.url_index;
    } else {
      resolvedUrlIndex = guessUrlColumn(targetHeaders, previewRow);
    }
  }

  // 2. Resolve other columns for all targetHeaders where index !== resolvedUrlIndex
  const unusedTemplateCols = [...templateMapping.columns];
  const columns: ColumnMapping[] = [];

  for (let i = 0; i < targetHeaders.length; i++) {
    if (i === resolvedUrlIndex) continue;
    const header = targetHeaders[i] ?? "";
    const headerNorm = norm(header);

    const matchIdx = unusedTemplateCols.findIndex(
      (tc) => norm(tc.source) === headerNorm,
    );

    if (matchIdx !== -1) {
      const matched = unusedTemplateCols[matchIdx]!;
      unusedTemplateCols.splice(matchIdx, 1);
      columns.push({
        index: i,
        source: header,
        label: matched.label || header || `Column ${i + 1}`,
        type: matched.type,
      });
    } else {
      columns.push({
        index: i,
        source: header,
        label: header || `Column ${i + 1}`,
        type: "text",
      });
    }
  }

  return { urlIndex: resolvedUrlIndex, columns };
}

/**
 * Builds a default CsvMapping from raw headers and an optional preview row.
 * The URL column is auto-guessed; every other column defaults to "text".
 * The caller (mapping screen) lets the user adjust everything.
 */
export function buildDefaultMapping(
  headers: readonly string[],
  previewRow?: readonly string[],
): {
  urlIndex: number;
  urlColumn: string;
  columns: { index: number; source: string; label: string; type: "text" }[];
} {
  const urlIndex = guessUrlColumn(headers, previewRow);
  const urlColumn = urlIndex >= 0 ? headers[urlIndex] : "";
  const columns = headers
    .map((h, i) => ({
      index: i,
      source: h,
      label: h || `Column ${i + 1}`,
      type: "text" as const,
    }))
    .filter((c) => c.index !== urlIndex);
  return { urlIndex, urlColumn, columns };
}

const RESERVED_EXTRA_LABELS = new Set([
  "url",
  "raw_url",
  "normalized_url",
  "host",
  "domain",
]);

/**
 * Cross-field checks zod cannot do. First problem in plain words, or null.
 * Ignored columns are never stored, so their labels do not count.
 */
export function validateMapping(m: {
  url_index: number;
  columns: readonly { index: number; label: string; type: ColumnType }[];
}): string | null {
  const seenIndex = new Set<number>([m.url_index]);
  for (const c of m.columns) {
    if (seenIndex.has(c.index)) return "Each column can only be mapped once.";
    seenIndex.add(c.index);
  }
  const seenLabel = new Set<string>();
  for (const c of m.columns) {
    if (c.type === "ignore") continue;
    const key = c.label.trim().toLowerCase();
    if (RESERVED_EXTRA_LABELS.has(key)) {
      return `"${c.label}" is reserved. Choose another name.`;
    }
    if (seenLabel.has(key)) {
      return `Two columns are both called "${c.label}". Rename one.`;
    }
    seenLabel.add(key);
  }
  return null;
}
