import { COUNTRIES, LANGUAGES } from "./locales";
import { JOB_STATUS_LABELS, PAGE_SIZE, type JobListParams } from "./rules";
import type { ActivityOption, JobEvent } from "./types";

// ---------------------------------------------------------------------
// Jobs list
// ---------------------------------------------------------------------

/** Builds a /jobs link that keeps the filters and drops empty ones. */
export function buildListHref(p: Partial<JobListParams>): string {
  const sp = new URLSearchParams();
  if (p.status) sp.set("status", p.status);
  if (p.q) sp.set("q", p.q);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  const qs = sp.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

export type PageRange = {
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

/** "Showing 26-50 of 61" and which arrows are live. */
export function pageRange(page: number, total: number): PageRange {
  if (total === 0) return { from: 0, to: 0, hasPrev: false, hasNext: false };
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return { from, to, hasPrev: page > 1, hasNext: to < total };
}

// ---------------------------------------------------------------------
// Job detail
// ---------------------------------------------------------------------

export const JOB_TABS = ["overview", "settings", "data", "activity"] as const;
export type JobTab = (typeof JOB_TABS)[number];

export const JOB_TAB_LABELS: Record<JobTab, string> = {
  overview: "Overview",
  settings: "Settings",
  data: "Data",
  activity: "Activity",
};

export function parseTab(raw: string | undefined): JobTab {
  return JOB_TABS.find((t) => t === raw) ?? "overview";
}

export function activityNames(
  keys: readonly string[],
  options: readonly ActivityOption[],
): string[] {
  const byKey = new Map(options.map((o) => [o.key, o.name]));
  return keys.map((k) => byKey.get(k) ?? k);
}

export function countryName(code: string | null): string | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

export function languageName(code: string | null): string | null {
  if (!code) return null;
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

// ---------------------------------------------------------------------
// Activity log wording
// ---------------------------------------------------------------------

/** Plain names for the job columns that appear in edit events. */
export const FIELD_LABELS: Record<string, string> = {
  name: "job name",
  client: "client",
  client_domain: "client domain",
  target_urls: "target URLs",
  business_type: "business type",
  sub_niche: "sub-niche",
  activity_keys: "activities",
  country: "country",
  language: "language",
  regions: "cities or regions",
  seed_keywords: "seed keywords",
  brand_variants: "brand variants",
  competitor_domains: "competitor domains",
  reference_sites: "reference sites",
  seed_list_urls: "seed list URLs",
  banned_categories: "banned categories",
  blocked_domains: "blocked domains",
  require_language_region_match: "language and region match",
  budget_credits: "credit budget",
  pages_per_query: "pages per query",
  saturation_n: "saturation window",
  saturation_x: "saturation minimum",
  per_domain_cap: "per-domain cap",
  review_queue_size: "review queue size",
  skip_previously_spam_domains: "skip earlier spam domains",
  scrape_credit_cap: "scrape credit cap",
  local_business: "local business data",
};

const MAX_FIELDS_SHOWN = 5;

function fieldList(payload: Record<string, unknown>): string {
  const raw = payload.fields;
  const fields = Array.isArray(raw)
    ? raw.filter((f): f is string => typeof f === "string")
    : [];
  if (fields.length === 0) return "settings";
  const names = fields.map((f) => FIELD_LABELS[f] ?? f.replaceAll("_", " "));
  if (names.length <= MAX_FIELDS_SHOWN) return names.join(", ");
  const rest = names.length - MAX_FIELDS_SHOWN;
  return `${names.slice(0, MAX_FIELDS_SHOWN).join(", ")} and ${rest} more`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * One sentence per event, without the person's name (the log shows that
 * separately). Unknown event types still read sensibly, so a new event
 * type never breaks the page.
 */
export function describeEvent(
  e: Pick<JobEvent, "type" | "payload" | "config_version">,
): string {
  const p = e.payload;

  switch (e.type) {
    case "created":
      return "Created the job.";
    case "edited":
      return `Edited ${fieldList(p)}.`;
    case "config_changed":
      return `Changed ${fieldList(p)}. Settings are now version ${e.config_version ?? "?"}.`;
    case "status_changed": {
      const reason = str(p.reason);
      switch (str(p.action)) {
        case "start":
          return "Started the job. It is queued for a worker.";
        case "pick_up":
          return "Picked up the job.";
        case "pause":
          return "Paused the job.";
        case "resume":
          return "Resumed the job.";
        case "stop":
          return reason ? `Stopped the job: ${reason}` : "Stopped the job.";
        case "complete":
          return "Finished every query. The job is completed.";
        case "saturate":
          return "Paused the job automatically: the latest queries found too few new domains.";
        case "fail":
          return reason ? `The job failed: ${reason}` : "The job failed.";
        default: {
          const from = str(p.from) as keyof typeof JOB_STATUS_LABELS | null;
          const to = str(p.to) as keyof typeof JOB_STATUS_LABELS | null;
          return from && to
            ? `Changed status from ${JOB_STATUS_LABELS[from] ?? from} to ${JOB_STATUS_LABELS[to] ?? to}.`
            : "Changed status.";
        }
      }
    }
    default: {
      const text = e.type.replaceAll("_", " ");
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
    }
  }
}

/** Who did it. Events written by the worker have no person. */
export function actorLabel(
  e: Pick<JobEvent, "actor_id" | "actor_name">,
): string {
  if (e.actor_name) return e.actor_name;
  return e.actor_id ? "A team member" : "System";
}
