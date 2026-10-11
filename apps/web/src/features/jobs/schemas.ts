import { z } from "zod";
import { COUNTRY_CODES, LANGUAGE_CODES } from "./locales";
import {
  cleanDomainList,
  cleanTextList,
  cleanUrlList,
  normalizeDomain,
  type ListResult,
} from "./rules";
import { JOB_ACTIONS, type LocalBusiness } from "./types";

// z.guid(), not z.uuid(): same reason as the roles schemas.
const guid = z.guid("That request was not valid.");
const optionalGuid = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  guid.optional(),
);

export const jobIdSchema = guid;

const ACTIVITY_KEY = /^[a-z][a-z0-9_]{1,49}$/;

/** Optional text: trimmed, empty becomes null. */
function optText(label: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, `${label} is too long (${max} characters max).`)
    .transform((v) => (v === "" ? null : v));
}

/** A whole number from a form field. Empty means "use the default". */
function intField(label: string, min: number, max: number, fallback: number) {
  return z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t === "" ? undefined : Number(t);
    },
    z
      .number({ error: `${label} must be a number.` })
      .int(`${label} must be a whole number.`)
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} must be at most ${max.toLocaleString("en-US")}.`)
      .default(fallback),
  );
}

/** Wraps a pure list cleaner so a failure becomes one form error. */
function list(clean: (raw: string[]) => ListResult) {
  return z.array(z.string()).transform((raw, ctx) => {
    const r = clean(raw);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.values;
  });
}

const textList = (label: string, max: number, maxLen: number, lower = false) =>
  list((raw) => cleanTextList(raw, { label, max, maxLen, lower }));
const domainList = (label: string, max: number) =>
  list((raw) => cleanDomainList(raw, { label, max }));
const urlList = (label: string, max: number) =>
  list((raw) => cleanUrlList(raw, { label, max }));

const domainField = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const d = normalizeDomain(v);
      if (!d) {
        ctx.addIssue({
          code: "custom",
          message: `${label} is not a valid domain.`,
        });
        return z.NEVER;
      }
      return d;
    });

const countryField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!COUNTRY_CODES.has(v)) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a country from the list.",
      });
      return z.NEVER;
    }
    return v;
  });

const languageField = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!LANGUAGE_CODES.has(v)) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a language from the list.",
      });
      return z.NEVER;
    }
    return v;
  });

const activityKeys = z
  .array(z.string().trim().regex(ACTIVITY_KEY, "That activity is not valid."))
  .max(20, "Too many activities selected.")
  // Sorted so the same selection never counts as a config change (A5).
  .transform((keys) => [...new Set(keys)].sort());

const PHONE = /^[+()\d\s.-]{5,25}$/;

/** Three optional fields in, one jsonb object (or null) out. */
const localBusiness = z
  .object({
    name: z
      .string()
      .trim()
      .max(150, "Business name is too long (150 characters max)."),
    address: z
      .string()
      .trim()
      .max(300, "Business address is too long (300 characters max)."),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || PHONE.test(v), "Business phone is not valid."),
  })
  .transform((b): LocalBusiness | null => {
    const out: LocalBusiness = {};
    if (b.name) out.name = b.name;
    if (b.address) out.address = b.address;
    if (b.phone) out.phone = b.phone;
    return Object.keys(out).length > 0 ? out : null;
  });

/**
 * The columns a signed-in user may write on public.jobs. Must match the
 * insert/update column grants in supabase/migrations/*_m2_jobs_rls.sql, or
 * PostgREST answers "permission denied". A unit test checks the schema
 * produces exactly these keys.
 */
export const JOB_WRITE_COLUMNS = [
  "name",
  "client",
  "client_domain",
  "target_urls",
  "business_type",
  "sub_niche",
  "activity_keys",
  "country",
  "language",
  "regions",
  "seed_keywords",
  "brand_variants",
  "competitor_domains",
  "reference_sites",
  "seed_list_urls",
  "banned_categories",
  "blocked_domains",
  "require_language_region_match",
  "budget_credits",
  "pages_per_query",
  "saturation_n",
  "saturation_x",
  "per_domain_cap",
  "review_queue_size",
  "skip_previously_spam_domains",
  "scrape_credit_cap",
  "local_business",
] as const;

export const saveJobSchema = z
  .object({
    /** Present when editing. */
    job_id: optionalGuid,
    /** Concurrency token: the job's updated_at when the form was loaded. */
    seen_updated_at: z
      .string()
      .trim()
      .max(64)
      .transform((v) => (v === "" ? undefined : v)),

    // Basics
    name: z
      .string()
      .trim()
      .min(2, "Job name needs at least 2 characters.")
      .max(100, "Job name is too long (100 characters max)."),
    client: optText("Client", 120),
    client_domain: domainField("Client domain"),
    target_urls: urlList("Target URLs", 50),
    business_type: optText("Business type", 80),
    sub_niche: optText("Sub-niche", 80),

    // Activities
    activity_keys: activityKeys,

    // Targeting
    country: countryField,
    language: languageField,
    regions: textList("Cities or regions", 50, 80),
    seed_keywords: textList("Seed keywords", 100, 100, true),
    brand_variants: textList("Brand name and variants", 30, 80),

    // Discovery sources
    competitor_domains: domainList("Competitor domains", 50),
    reference_sites: domainList("Reference sites", 50),
    seed_list_urls: urlList("Seed list URLs", 500),

    // Filters
    banned_categories: textList("Banned categories", 50, 60, true),
    blocked_domains: domainList("Blocked domains", 500),
    require_language_region_match: z.boolean(),

    // Limits
    budget_credits: intField("Credit budget", 0, 1_000_000, 0),
    pages_per_query: intField("Pages per query", 1, 10, 1),
    saturation_n: intField("Saturation window (queries)", 1, 1000, 20),
    saturation_x: intField("Saturation minimum new domains", 0, 1000, 3),
    per_domain_cap: intField("Per-domain cap", 1, 1000, 10),
    review_queue_size: intField("Review queue size", 1, 500, 50),
    skip_previously_spam_domains: z.boolean(),
    scrape_credit_cap: intField("Scrape credit cap", 0, 1_000_000, 0),

    // Local business data
    local_business: localBusiness,
  })
  .superRefine((d, ctx) => {
    if (d.job_id && !d.seen_updated_at) {
      ctx.addIssue({
        code: "custom",
        message: "That request was not valid. Reload the page and try again.",
      });
    }
    if (d.client_domain && d.competitor_domains.includes(d.client_domain)) {
      ctx.addIssue({
        code: "custom",
        message: "The client's own domain cannot also be a competitor.",
      });
    }
  });

export type SaveJobInput = z.output<typeof saveJobSchema>;

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};
const strings = (formData: FormData, key: string) =>
  formData.getAll(key).filter((v): v is string => typeof v === "string");

/**
 * List fields arrive as repeated entries (one hidden input per chip),
 * checkboxes as "on". Everything else is a plain string.
 */
export function jobFormInput(formData: FormData) {
  return {
    job_id: formData.get("job_id"),
    seen_updated_at: str(formData, "seen_updated_at"),

    name: str(formData, "name"),
    client: str(formData, "client"),
    client_domain: str(formData, "client_domain"),
    target_urls: strings(formData, "target_urls"),
    business_type: str(formData, "business_type"),
    sub_niche: str(formData, "sub_niche"),

    activity_keys: strings(formData, "activity_keys"),

    country: str(formData, "country"),
    language: str(formData, "language"),
    regions: strings(formData, "regions"),
    seed_keywords: strings(formData, "seed_keywords"),
    brand_variants: strings(formData, "brand_variants"),

    competitor_domains: strings(formData, "competitor_domains"),
    reference_sites: strings(formData, "reference_sites"),
    seed_list_urls: strings(formData, "seed_list_urls"),

    banned_categories: strings(formData, "banned_categories"),
    blocked_domains: strings(formData, "blocked_domains"),
    require_language_region_match:
      formData.get("require_language_region_match") === "on",

    budget_credits: str(formData, "budget_credits"),
    pages_per_query: str(formData, "pages_per_query"),
    saturation_n: str(formData, "saturation_n"),
    saturation_x: str(formData, "saturation_x"),
    per_domain_cap: str(formData, "per_domain_cap"),
    review_queue_size: str(formData, "review_queue_size"),
    skip_previously_spam_domains:
      formData.get("skip_previously_spam_domains") === "on",
    scrape_credit_cap: str(formData, "scrape_credit_cap"),

    local_business: {
      name: str(formData, "local_business_name"),
      address: str(formData, "local_business_address"),
      phone: str(formData, "local_business_phone"),
    },
  };
}

export const transitionJobSchema = z.object({
  job_id: guid,
  action: z.enum(JOB_ACTIONS, { error: "That action is not valid." }),
  reason: z
    .string()
    .trim()
    .max(200, "Reason is too long (200 characters max).")
    .optional()
    .transform((v) => v || undefined),
  confirm: z.string().optional(),
});

export const deleteJobSchema = z.object({ job_id: guid });
