import { describe, expect, it } from "vitest";
import { firstIssue } from "../../lib/auth/schemas";
import {
  JOB_WRITE_COLUMNS,
  deleteJobSchema,
  jobFormInput,
  saveJobSchema,
  transitionJobSchema,
} from "./schemas";

/** The smallest valid form: only the name is required (Drafts may be empty). */
function minimal(extra: Record<string, string | string[]> = {}) {
  const fd = new FormData();
  fd.set("name", "Yogaban backlinks");
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
    else fd.set(k, v);
  }
  return fd;
}

function parse(extra: Record<string, string | string[]> = {}) {
  return saveJobSchema.safeParse(jobFormInput(minimal(extra)));
}

describe("saveJobSchema", () => {
  it("accepts an empty draft and fills the defaults", () => {
    const r = parse();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      name: "Yogaban backlinks",
      client: null,
      client_domain: null,
      country: null,
      language: null,
      target_urls: [],
      seed_keywords: [],
      activity_keys: [],
      require_language_region_match: false,
      skip_previously_spam_domains: false,
      budget_credits: 0,
      pages_per_query: 1,
      saturation_n: 20,
      saturation_x: 3,
      per_domain_cap: 10,
      review_queue_size: 50,
      scrape_credit_cap: 0,
      local_business: null,
    });
  });

  it("writes only columns the database grants", () => {
    const r = parse();
    expect(r.success).toBe(true);
    if (!r.success) return;
    const { job_id, seen_updated_at, ...values } = r.data;
    void job_id;
    void seen_updated_at;
    expect(Object.keys(values).sort()).toEqual([...JOB_WRITE_COLUMNS].sort());
  });

  it("needs a name of at least 2 characters", () => {
    const fd = minimal({ name: " a " });
    const r = saveJobSchema.safeParse(jobFormInput(fd));
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toContain("at least 2");
  });

  it("cleans the client domain", () => {
    const r = parse({ client_domain: "https://www.Yogaban.com/retreats" });
    expect(r.success && r.data.client_domain).toBe("yogaban.com");
  });

  it("explains a bad client domain", () => {
    const r = parse({ client_domain: "not a domain" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(firstIssue(r.error)).toBe("Client domain is not a valid domain.");
    }
  });

  it("validates country and language against the pick lists", () => {
    const ok = parse({ country: "in", language: "EN" });
    expect(ok.success && [ok.data.country, ok.data.language]).toEqual([
      "IN",
      "en",
    ]);
    expect(parse({ country: "ZZ" }).success).toBe(false);
    expect(parse({ language: "xx" }).success).toBe(false);
  });

  it("lowercases and de-duplicates seed keywords, keeping order", () => {
    const r = parse({
      seed_keywords: ["Yoga Retreat", "yoga  retreat", "Bali"],
    });
    expect(r.success && r.data.seed_keywords).toEqual(["yoga retreat", "bali"]);
  });

  it("sorts activity keys so a reorder is not a config change", () => {
    const r = parse({
      activity_keys: ["resource_page", "guest_post", "guest_post"],
    });
    expect(r.success && r.data.activity_keys).toEqual([
      "guest_post",
      "resource_page",
    ]);
  });

  it("rejects an invalid activity key", () => {
    expect(parse({ activity_keys: ["Guest Post"] }).success).toBe(false);
  });

  it("normalizes competitor, reference and blocked domains", () => {
    const r = parse({
      competitor_domains: ["https://www.rival.com/a", "rival.com"],
      reference_sites: ["Example.org"],
      blocked_domains: ["spam.net"],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.competitor_domains).toEqual(["rival.com"]);
    expect(r.data.reference_sites).toEqual(["example.org"]);
    expect(r.data.blocked_domains).toEqual(["spam.net"]);
  });

  it("does not let the client be its own competitor", () => {
    const r = parse({
      client_domain: "yogaban.com",
      competitor_domains: ["www.yogaban.com"],
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(firstIssue(r.error)).toContain("cannot also be a competitor");
  });

  it("cleans target and seed list URLs", () => {
    const r = parse({
      target_urls: ["yogaban.com/retreats#top"],
      seed_list_urls: ["https://example.org/links", "example.org/links"],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.target_urls).toEqual(["https://yogaban.com/retreats"]);
    expect(r.data.seed_list_urls).toEqual(["https://example.org/links"]);
  });

  it("rejects an unsafe seed list URL", () => {
    expect(parse({ seed_list_urls: ["http://127.0.0.1/admin"] }).success).toBe(
      false,
    );
  });

  describe("number fields", () => {
    it("uses the default for an empty field", () => {
      const r = parse({ budget_credits: "  ", saturation_n: "" });
      expect(r.success && [r.data.budget_credits, r.data.saturation_n]).toEqual(
        [0, 20],
      );
    });

    it("reads a valid number", () => {
      const r = parse({ budget_credits: "500", pages_per_query: "3" });
      expect(
        r.success && [r.data.budget_credits, r.data.pages_per_query],
      ).toEqual([500, 3]);
    });

    it.each([
      [{ budget_credits: "abc" }, "must be a number"],
      [{ budget_credits: "1.5" }, "whole number"],
      [{ budget_credits: "-1" }, "at least 0"],
      [{ pages_per_query: "0" }, "at least 1"],
      [{ pages_per_query: "11" }, "at most 10"],
      [{ review_queue_size: "501" }, "at most 500"],
      [{ per_domain_cap: "0" }, "at least 1"],
    ])("rejects %j", (extra, snippet) => {
      const r = parse(extra);
      expect(r.success).toBe(false);
      if (!r.success) expect(firstIssue(r.error)).toContain(snippet);
    });
  });

  it("reads checkboxes", () => {
    const fd = minimal({
      require_language_region_match: "on",
      skip_previously_spam_domains: "on",
    });
    const r = saveJobSchema.safeParse(jobFormInput(fd));
    expect(
      r.success && [
        r.data.require_language_region_match,
        r.data.skip_previously_spam_domains,
      ],
    ).toEqual([true, true]);
  });

  describe("local business data", () => {
    it("is null when nothing is filled in", () => {
      const r = parse();
      expect(r.success && r.data.local_business).toBeNull();
    });

    it("keeps only the fields that were filled in", () => {
      const r = parse({
        local_business_name: " Yogaban Studio ",
        local_business_phone: "+91 98765 43210",
      });
      expect(r.success && r.data.local_business).toEqual({
        name: "Yogaban Studio",
        phone: "+91 98765 43210",
      });
    });

    it("rejects a phone number with letters", () => {
      expect(parse({ local_business_phone: "call me" }).success).toBe(false);
    });
  });

  describe("editing", () => {
    const id = "00000000-0000-0000-0000-0000000000a1";

    it("needs the concurrency token", () => {
      const r = parse({ job_id: id });
      expect(r.success).toBe(false);
      if (!r.success) expect(firstIssue(r.error)).toContain("Reload the page");
    });

    it("accepts a job id with its token", () => {
      const r = parse({
        job_id: id,
        seen_updated_at: "2026-10-11T05:00:00.123456+00:00",
      });
      expect(r.success && r.data.job_id).toBe(id);
    });

    it("rejects a malformed job id", () => {
      expect(parse({ job_id: "nope", seen_updated_at: "x" }).success).toBe(
        false,
      );
    });
  });
});

describe("transitionJobSchema", () => {
  const id = "00000000-0000-0000-0000-0000000000a1";

  it("accepts the four user actions", () => {
    for (const action of ["start", "pause", "resume", "stop"]) {
      expect(
        transitionJobSchema.safeParse({ job_id: id, action }).success,
      ).toBe(true);
    }
  });

  it("rejects worker actions", () => {
    expect(
      transitionJobSchema.safeParse({ job_id: id, action: "complete" }).success,
    ).toBe(false);
  });

  it("trims the reason and drops an empty one", () => {
    const a = transitionJobSchema.safeParse({
      job_id: id,
      action: "stop",
      reason: "  ",
    });
    expect(a.success && a.data.reason).toBeUndefined();
    const b = transitionJobSchema.safeParse({
      job_id: id,
      action: "stop",
      reason: " done ",
    });
    expect(b.success && b.data.reason).toBe("done");
  });

  it("limits the reason length", () => {
    expect(
      transitionJobSchema.safeParse({
        job_id: id,
        action: "stop",
        reason: "x".repeat(201),
      }).success,
    ).toBe(false);
  });
});

describe("deleteJobSchema", () => {
  it("needs a valid id", () => {
    expect(deleteJobSchema.safeParse({ job_id: "nope" }).success).toBe(false);
    expect(
      deleteJobSchema.safeParse({
        job_id: "00000000-0000-0000-0000-0000000000a1",
      }).success,
    ).toBe(true);
  });
});
