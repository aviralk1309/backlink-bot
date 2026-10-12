import { normalizeDomain, normalizeUrl } from "./rules";
import type { JobRow } from "./types";

/**
 * The job form keeps every field as a string (or a list of strings) so the
 * inputs stay controlled. The server action turns them into typed values.
 */
export type JobFormValues = {
  /** null when creating. */
  id: string | null;
  /** The job's updated_at when the form was loaded (edit conflict check). */
  updatedAt: string | null;

  name: string;
  client: string;
  clientDomain: string;
  targetUrls: string[];
  businessType: string;
  subNiche: string;

  activityKeys: string[];

  country: string;
  language: string;
  regions: string[];
  seedKeywords: string[];
  brandVariants: string[];

  competitorDomains: string[];
  referenceSites: string[];
  seedListUrls: string[];

  bannedCategories: string[];
  blockedDomains: string[];
  requireLanguageRegionMatch: boolean;
  skipPreviouslySpamDomains: boolean;

  budgetCredits: string;
  pagesPerQuery: string;
  saturationN: string;
  saturationX: string;
  perDomainCap: string;
  reviewQueueSize: string;
  scrapeCreditCap: string;

  localBusinessName: string;
  localBusinessAddress: string;
  localBusinessPhone: string;
};

/**
 * The `name` of each input. These must equal what jobFormInput() in
 * schemas.ts reads; form-values.test.ts round-trips every field to prove it.
 */
export const FIELD: Record<keyof JobFormValues, string> = {
  id: "job_id",
  updatedAt: "seen_updated_at",
  name: "name",
  client: "client",
  clientDomain: "client_domain",
  targetUrls: "target_urls",
  businessType: "business_type",
  subNiche: "sub_niche",
  activityKeys: "activity_keys",
  country: "country",
  language: "language",
  regions: "regions",
  seedKeywords: "seed_keywords",
  brandVariants: "brand_variants",
  competitorDomains: "competitor_domains",
  referenceSites: "reference_sites",
  seedListUrls: "seed_list_urls",
  bannedCategories: "banned_categories",
  blockedDomains: "blocked_domains",
  requireLanguageRegionMatch: "require_language_region_match",
  skipPreviouslySpamDomains: "skip_previously_spam_domains",
  budgetCredits: "budget_credits",
  pagesPerQuery: "pages_per_query",
  saturationN: "saturation_n",
  saturationX: "saturation_x",
  perDomainCap: "per_domain_cap",
  reviewQueueSize: "review_queue_size",
  scrapeCreditCap: "scrape_credit_cap",
  localBusinessName: "local_business_name",
  localBusinessAddress: "local_business_address",
  localBusinessPhone: "local_business_phone",
};

/** Same defaults as the database and saveJobSchema (a test checks this). */
export const NUMBER_DEFAULTS = {
  budgetCredits: "0",
  pagesPerQuery: "1",
  saturationN: "20",
  saturationX: "3",
  perDomainCap: "10",
  reviewQueueSize: "50",
  scrapeCreditCap: "0",
} as const;

export function emptyJobFormValues(): JobFormValues {
  return {
    id: null,
    updatedAt: null,
    name: "",
    client: "",
    clientDomain: "",
    targetUrls: [],
    businessType: "",
    subNiche: "",
    activityKeys: [],
    country: "",
    language: "",
    regions: [],
    seedKeywords: [],
    brandVariants: [],
    competitorDomains: [],
    referenceSites: [],
    seedListUrls: [],
    bannedCategories: [],
    blockedDomains: [],
    requireLanguageRegionMatch: false,
    skipPreviouslySpamDomains: false,
    ...NUMBER_DEFAULTS,
    localBusinessName: "",
    localBusinessAddress: "",
    localBusinessPhone: "",
  };
}

export function jobToFormValues(job: JobRow): JobFormValues {
  return {
    id: job.id,
    updatedAt: job.updated_at,
    name: job.name,
    client: job.client ?? "",
    clientDomain: job.client_domain ?? "",
    targetUrls: job.target_urls,
    businessType: job.business_type ?? "",
    subNiche: job.sub_niche ?? "",
    activityKeys: job.activity_keys,
    country: job.country ?? "",
    language: job.language ?? "",
    regions: job.regions,
    seedKeywords: job.seed_keywords,
    brandVariants: job.brand_variants,
    competitorDomains: job.competitor_domains,
    referenceSites: job.reference_sites,
    seedListUrls: job.seed_list_urls,
    bannedCategories: job.banned_categories,
    blockedDomains: job.blocked_domains,
    requireLanguageRegionMatch: job.require_language_region_match,
    skipPreviouslySpamDomains: job.skip_previously_spam_domains,
    budgetCredits: String(job.budget_credits),
    pagesPerQuery: String(job.pages_per_query),
    saturationN: String(job.saturation_n),
    saturationX: String(job.saturation_x),
    perDomainCap: String(job.per_domain_cap),
    reviewQueueSize: String(job.review_queue_size),
    scrapeCreditCap: String(job.scrape_credit_cap),
    localBusinessName: job.local_business?.name ?? "",
    localBusinessAddress: job.local_business?.address ?? "",
    localBusinessPhone: job.local_business?.phone ?? "",
  };
}

// ---------------------------------------------------------------------
// Chip input logic (pure, so it is unit-tested)
// ---------------------------------------------------------------------

export type ChipKind = "text" | "domain" | "url";

export type ChipOptions = {
  kind: ChipKind;
  max: number;
  /** Text chips only. */
  maxLen?: number;
  lower?: boolean;
};

/**
 * How many chips each field takes. Keep in sync with saveJobSchema in
 * schemas.ts: a test feeds max and max + 1 entries through the real schema.
 */
export const LIMITS = {
  targetUrls: { kind: "url", max: 50 },
  regions: { kind: "text", max: 50, maxLen: 80 },
  seedKeywords: { kind: "text", max: 100, maxLen: 100, lower: true },
  brandVariants: { kind: "text", max: 30, maxLen: 80 },
  competitorDomains: { kind: "domain", max: 50 },
  referenceSites: { kind: "domain", max: 50 },
  seedListUrls: { kind: "url", max: 500 },
  bannedCategories: { kind: "text", max: 50, maxLen: 60, lower: true },
  blockedDomains: { kind: "domain", max: 500 },
} as const satisfies Record<string, ChipOptions>;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function preview(s: string): string {
  const c = collapse(s);
  return c.length > 40 ? `${c.slice(0, 40)}…` : c;
}

/**
 * Splits pasted or typed text into separate entries. Text chips may contain
 * spaces, so they split on commas, semicolons and new lines only. Domains
 * and URLs never contain spaces, so any whitespace splits them too. URLs may
 * contain commas, so those do not split URLs.
 */
export function splitEntries(raw: string, kind: ChipKind): string[] {
  const separator =
    kind === "url" ? /\s+/ : kind === "domain" ? /[\s,;]+/ : /[\n,;]+/;
  return raw
    .split(separator)
    .map((p) => p.trim())
    .filter(Boolean);
}

export type AddResult = {
  values: string[];
  /** Entries that were not added, so the input can keep them for fixing. */
  rejected: string[];
  error: string | null;
};

/**
 * Adds typed or pasted entries to a chip list. Valid entries are added even
 * when others in the same paste are not. Duplicates (ignoring case) are
 * skipped without an error.
 */
export function addEntries(
  current: readonly string[],
  raw: string,
  o: ChipOptions,
): AddResult {
  const values = [...current];
  const seen = new Set(values.map((v) => v.toLowerCase()));
  const rejected: string[] = [];
  let error: string | null = null;

  const fail = (entry: string, why: string) => {
    rejected.push(entry);
    error ??= why;
  };

  for (const entry of splitEntries(raw, o.kind)) {
    let value: string | null;
    if (o.kind === "domain") value = normalizeDomain(entry);
    else if (o.kind === "url") value = normalizeUrl(entry);
    else {
      const c = collapse(entry);
      value = o.lower ? c.toLowerCase() : c;
    }

    if (value === null) {
      fail(
        entry,
        `“${preview(entry)}” is not a valid ${o.kind === "domain" ? "domain" : "web address"}.`,
      );
      continue;
    }
    if (o.kind === "text" && o.maxLen && value.length > o.maxLen) {
      fail(
        entry,
        `“${preview(entry)}” is too long (${o.maxLen} characters max).`,
      );
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    if (values.length >= o.max) {
      fail(entry, `You can add at most ${o.max} entries here.`);
      continue;
    }
    seen.add(key);
    values.push(value);
  }

  return { values, rejected, error };
}
