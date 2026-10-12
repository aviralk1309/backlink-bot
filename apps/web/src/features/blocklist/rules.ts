import { splitEntries } from "../jobs/form-values";
import { cleanDomainList, sanitizeSearch } from "../jobs/rules";

export const BLOCKLIST_PAGE_SIZE = 50;
export const MAX_BATCH = 500;
export const REASON_MAX = 200;

export type BatchResult =
  { ok: true; domains: string[] } | { ok: false; error: string };

/**
 * Turns pasted text into clean domains. One bad entry stops the whole batch
 * (and is named), so a typo is never silently dropped.
 */
export function parseDomainBatch(raw: string): BatchResult {
  const entries = splitEntries(raw, "domain");
  if (entries.length === 0) {
    return { ok: false, error: "Enter at least one domain." };
  }
  const r = cleanDomainList(entries, { label: "Domains", max: MAX_BATCH });
  return r.ok ? { ok: true, domains: r.values } : { ok: false, error: r.error };
}

export type BlocklistParams = { q: string; page: number };

export function parseBlocklistParams(raw: {
  q?: string;
  page?: string;
}): BlocklistParams {
  const n = Number.parseInt(raw.page ?? "1", 10);
  const page = Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
  return { q: sanitizeSearch(raw.q ?? ""), page };
}

export function blocklistHref(p: Partial<BlocklistParams>): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  const qs = sp.toString();
  return qs ? `/admin/blocklist?${qs}` : "/admin/blocklist";
}

/** "Added 3 domains. 2 were already blocked." */
export function addSummary(added: number, skipped: number): string {
  const noun = (n: number) => `${n} domain${n === 1 ? "" : "s"}`;
  if (added === 0) {
    return skipped === 1
      ? "That domain was already blocked."
      : `All ${skipped} domains were already blocked.`;
  }
  const base = `Added ${noun(added)}.`;
  if (skipped === 0) return base;
  return `${base} ${skipped} ${skipped === 1 ? "was" : "were"} already blocked.`;
}
