import { describe, expect, it } from "vitest";
import {
  FIELD,
  LIMITS,
  NUMBER_DEFAULTS,
  addEntries,
  emptyJobFormValues,
  jobToFormValues,
  splitEntries,
  type JobFormValues,
} from "./form-values";
import { JOB_WRITE_COLUMNS, jobFormInput, saveJobSchema } from "./schemas";
import type { JobRow } from "./types";

/** What the browser would submit for these form values. */
function toFormData(values: JobFormValues): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    const name = FIELD[key as keyof JobFormValues];
    if (Array.isArray(value)) value.forEach((item) => fd.append(name, item));
    else if (typeof value === "boolean") {
      if (value) fd.set(name, "on");
    } else if (value !== null) fd.set(name, value);
  }
  return fd;
}

const parse = (values: JobFormValues) =>
  saveJobSchema.safeParse(jobFormInput(toFormData(values)));

const sampleJob: JobRow = {
  id: "00000000-0000-0000-0000-0000000000a1",
  job_type: "search_backlinks",
  name: "Yogaban backlinks",
  client: "Yogaban",
  client_domain: "yogaban.com",
  target_urls: ["https://yogaban.com/retreats"],
  business_type: "yoga retreats",
  sub_niche: "wellness travel",
  activity_keys: ["guest_post", "resource_page"],
  country: "IN",
  language: "en",
  regions: ["Rishikesh", "Goa"],
  seed_keywords: ["yoga retreat", "yoga teacher training"],
  brand_variants: ["Yogaban", "Yoga Ban"],
  competitor_domains: ["rival.com"],
  reference_sites: ["example.org"],
  seed_list_urls: ["https://example.org/links"],
  banned_categories: ["casino"],
  blocked_domains: ["spam.net"],
  require_language_region_match: true,
  budget_credits: 500,
  pages_per_query: 2,
  saturation_n: 25,
  saturation_x: 4,
  per_domain_cap: 5,
  review_queue_size: 40,
  skip_previously_spam_domains: true,
  scrape_credit_cap: 10,
  local_business: { name: "Yogaban Studio", phone: "+91 98765 43210" },
  status: "draft",
  status_reason: null,
  config_version: 1,
  started_at: null,
  finished_at: null,
  created_by: null,
  created_at: "2026-10-11T05:00:00.000000+00:00",
  updated_at: "2026-10-11T05:30:00.123456+00:00",
};

describe("form field names", () => {
  it("round-trips every field through the real schema", () => {
    const r = parse(jobToFormValues(sampleJob));
    expect(r.success).toBe(true);
    if (!r.success) return;
    for (const col of JOB_WRITE_COLUMNS) {
      expect(r.data[col], col).toEqual(sampleJob[col]);
    }
    expect(r.data.job_id).toBe(sampleJob.id);
    expect(r.data.seen_updated_at).toBe(sampleJob.updated_at);
  });

  it("saving an unchanged job produces the same values (no config bump)", () => {
    const first = parse(jobToFormValues(sampleJob));
    expect(first.success).toBe(true);
    if (!first.success) return;
    // Feed the cleaned output back through the form, as a second save would.
    const again = parse(
      jobToFormValues({ ...sampleJob, ...first.data } as unknown as JobRow),
    );
    expect(again.success && again.data).toEqual(first.data);
  });

  it("has a distinct input name for every field", () => {
    const names = Object.values(FIELD);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("defaults", () => {
  it("match the schema defaults for the number fields", () => {
    const r = parse({ ...emptyJobFormValues(), name: "A job" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.budget_credits).toBe(Number(NUMBER_DEFAULTS.budgetCredits));
    expect(r.data.pages_per_query).toBe(Number(NUMBER_DEFAULTS.pagesPerQuery));
    expect(r.data.saturation_n).toBe(Number(NUMBER_DEFAULTS.saturationN));
    expect(r.data.saturation_x).toBe(Number(NUMBER_DEFAULTS.saturationX));
    expect(r.data.per_domain_cap).toBe(Number(NUMBER_DEFAULTS.perDomainCap));
    expect(r.data.review_queue_size).toBe(
      Number(NUMBER_DEFAULTS.reviewQueueSize),
    );
    expect(r.data.scrape_credit_cap).toBe(
      Number(NUMBER_DEFAULTS.scrapeCreditCap),
    );
  });

  it("start a new job with no id and no token", () => {
    const v = emptyJobFormValues();
    expect(v.id).toBeNull();
    expect(v.updatedAt).toBeNull();
  });
});

describe("limits match the schema", () => {
  const sample = (kind: "text" | "domain" | "url", i: number) =>
    kind === "domain"
      ? `d${i}.com`
      : kind === "url"
        ? `https://d${i}.com`
        : `entry ${i}`;

  const formKeys = Object.keys(LIMITS) as (keyof typeof LIMITS)[];

  it.each(formKeys)("%s takes exactly max entries", (key) => {
    const o = LIMITS[key];
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => sample(o.kind, i));
    const base = { ...emptyJobFormValues(), name: "A job" };

    expect(parse({ ...base, [key]: make(o.max) }).success).toBe(true);
    expect(parse({ ...base, [key]: make(o.max + 1) }).success).toBe(false);
  });

  it.each(
    formKeys.filter((k) => "maxLen" in LIMITS[k]) as (keyof typeof LIMITS)[],
  )("%s takes entries up to maxLen characters", (key) => {
    const o = LIMITS[key] as { maxLen: number };
    const base = { ...emptyJobFormValues(), name: "A job" };
    expect(parse({ ...base, [key]: ["a".repeat(o.maxLen)] }).success).toBe(
      true,
    );
    expect(parse({ ...base, [key]: ["a".repeat(o.maxLen + 1)] }).success).toBe(
      false,
    );
  });
});

describe("splitEntries", () => {
  it("splits text on commas, semicolons and new lines, keeping spaces", () => {
    expect(splitEntries("yoga retreat, bali;goa\nrishikesh", "text")).toEqual([
      "yoga retreat",
      "bali",
      "goa",
      "rishikesh",
    ]);
  });

  it("splits domains on any whitespace and commas", () => {
    expect(splitEntries("a.com b.com,c.com\nd.com", "domain")).toEqual([
      "a.com",
      "b.com",
      "c.com",
      "d.com",
    ]);
  });

  it("splits URLs on whitespace only, so commas survive", () => {
    expect(splitEntries("https://a.com/x,y https://b.com", "url")).toEqual([
      "https://a.com/x,y",
      "https://b.com",
    ]);
  });

  it("drops empty pieces", () => {
    expect(splitEntries(" , ;\n ", "text")).toEqual([]);
  });
});

describe("addEntries", () => {
  const text = { kind: "text", max: 3, maxLen: 12 } as const;
  const domain = { kind: "domain", max: 5 } as const;
  const url = { kind: "url", max: 5 } as const;

  it("adds cleaned text", () => {
    expect(addEntries([], "  Yoga   Retreat ", text)).toEqual({
      values: ["Yoga Retreat"],
      rejected: [],
      error: null,
    });
  });

  it("lowercases when asked", () => {
    expect(addEntries([], "Yoga", { ...text, lower: true }).values).toEqual([
      "yoga",
    ]);
  });

  it("skips duplicates ignoring case, without an error", () => {
    const r = addEntries(["yoga"], "YOGA, bali", text);
    expect(r).toEqual({ values: ["yoga", "bali"], rejected: [], error: null });
  });

  it("adds valid domains and keeps the invalid ones for fixing", () => {
    const r = addEntries([], "https://www.a.com/x nonsense b.org", domain);
    expect(r.values).toEqual(["a.com", "b.org"]);
    expect(r.rejected).toEqual(["nonsense"]);
    expect(r.error).toBe("“nonsense” is not a valid domain.");
  });

  it("explains a bad web address", () => {
    const r = addEntries([], "http://localhost/x", url);
    expect(r.values).toEqual([]);
    expect(r.error).toBe("“http://localhost/x” is not a valid web address.");
  });

  it("rejects text that is too long", () => {
    const r = addEntries([], "this is much too long", text);
    expect(r.values).toEqual([]);
    expect(r.error).toContain("too long (12 characters max)");
  });

  it("stops at the maximum and says so", () => {
    const r = addEntries(["a", "b"], "c, d, e", text);
    expect(r.values).toEqual(["a", "b", "c"]);
    expect(r.rejected).toEqual(["d", "e"]);
    expect(r.error).toBe("You can add at most 3 entries here.");
  });

  it("does nothing for empty input", () => {
    expect(addEntries(["a"], "  ", text)).toEqual({
      values: ["a"],
      rejected: [],
      error: null,
    });
  });
});
