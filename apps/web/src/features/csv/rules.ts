import { getDomain } from "tldts";
import { ACCEPTED_EXTENSIONS, MAX_CSV_BYTES } from "./limits";

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
