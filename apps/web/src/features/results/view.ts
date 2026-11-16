import type { Json } from "@/lib/database.types";

export const RESULTS_PAGE_SIZE = 50;
export const QUEUES = ["ready", "backlog", "auto_filtered", "all"] as const;
export const TIERS = ["high", "medium", "low", "unchecked"] as const;
export const SOURCES = [
  "competitor_csv",
  "seed_list",
  "google",
  "site_crawl",
] as const;
export const REVIEW_STATUSES = [
  "new",
  "in_review",
  "approved",
  "rejected",
  "used",
] as const;
export const FLAGS = [
  "client_unknown",
  "previous_spam",
  "already_links",
  "domain_cap",
] as const;

export type ResultsParams = {
  queue: (typeof QUEUES)[number];
  tier: (typeof TIERS)[number] | null;
  activity: string | null;
  source: (typeof SOURCES)[number] | null;
  status: (typeof REVIEW_STATUSES)[number] | null;
  domain: string | null;
  q: string | null;
  flag: (typeof FLAGS)[number] | null;
  sort: "score" | "newest";
  group: boolean;
  cursor: string | null;
};

const first = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : null;
const choice = <T extends string>(
  value: string | null,
  options: readonly T[],
): T | null => options.find((option) => option === value) ?? null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9.-]{1,253}$/;

export function parseResultsParams(
  raw: Record<string, string | string[] | undefined>,
): ResultsParams {
  const group = first(raw.group) === "domain";
  const domain = first(raw.domain)?.trim().toLowerCase() ?? "";
  const cursor = first(raw.cursor);
  const q = first(raw.q)?.trim().slice(0, 100) ?? "";
  return {
    queue: choice(first(raw.queue), QUEUES) ?? "ready",
    tier: choice(first(raw.tier), TIERS),
    activity: first(raw.activity)?.trim().slice(0, 100) || null,
    source: choice(first(raw.source), SOURCES),
    status: choice(first(raw.status), REVIEW_STATUSES),
    domain: DOMAIN.test(domain) ? domain : null,
    q: q || null,
    flag: choice(first(raw.flag), FLAGS),
    sort: first(raw.sort) === "newest" ? "newest" : "score",
    group,
    cursor:
      cursor && (group ? DOMAIN.test(cursor) : UUID.test(cursor))
        ? cursor
        : null,
  };
}

export function resultsHref(
  jobId: string,
  params: ResultsParams,
  change: Partial<ResultsParams> & { detail?: string | null } = {},
): string {
  const p = { ...params, ...change };
  const qs = new URLSearchParams({ tab: "results" });
  if (p.queue !== "ready") qs.set("queue", p.queue);
  for (const key of [
    "tier",
    "activity",
    "source",
    "status",
    "domain",
    "q",
    "flag",
  ] as const) {
    if (p[key]) qs.set(key, p[key]);
  }
  if (p.sort !== "score") qs.set("sort", p.sort);
  if (p.group) qs.set("group", "domain");
  if (p.cursor) qs.set("cursor", p.cursor);
  if (change.detail && UUID.test(change.detail))
    qs.set("detail", change.detail);
  return `/jobs/${jobId}?${qs}`;
}

export function detailId(
  raw: Record<string, string | string[] | undefined>,
): string | null {
  const id = first(raw.detail);
  return id && UUID.test(id) ? id : null;
}

export function searchPattern(q: string | null): string | null {
  return q?.replace(/[\\%_]/g, "\\$&") ?? null;
}

export function topReasons(breakdown: Json | null): string[] {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown))
    return [];
  const reasons = breakdown.top_reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons
    .slice(0, 3)
    .map((reason) =>
      reason && typeof reason === "object" && !Array.isArray(reason)
        ? reason.text
        : null,
    )
    .filter((text): text is string => typeof text === "string" && text !== "");
}
