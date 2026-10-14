/**
 * Phase 4 QA: Form Validation, Edge Cases & Boundary Value Analysis
 *
 * These tests exhaustively cover every field, character limit, and boundary
 * condition to ensure zero crashes and correct rejection messages.
 */
import { describe, expect, it } from "vitest";
import { firstIssue } from "../../lib/auth/schemas";
import { jobFormInput, saveJobSchema } from "./schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function ok(extra: Record<string, string | string[]> = {}) {
  const r = parse(extra);
  if (!r.success)
    throw new Error(`Expected success, got: ${firstIssue(r.error)}`);
  return r.data;
}

function fail(extra: Record<string, string | string[]> = {}) {
  const r = parse(extra);
  if (r.success)
    throw new Error("Expected failure but schema accepted the input");
  return firstIssue(r.error);
}

// ---------------------------------------------------------------------------
// 1. Job name boundaries
// ---------------------------------------------------------------------------

describe("job name boundaries", () => {
  it("rejects a single-character name (< 2)", () => {
    expect(fail({ name: "X" })).toContain("at least 2");
  });

  it("rejects a name that is only whitespace after trim", () => {
    expect(fail({ name: "   " })).toContain("at least 2");
  });

  it("accepts exactly 2 characters", () => {
    expect(() => ok({ name: "AB" })).not.toThrow();
  });

  it("accepts exactly 100 characters", () => {
    expect(() => ok({ name: "a".repeat(100) })).not.toThrow();
  });

  it("rejects 101 characters", () => {
    expect(fail({ name: "a".repeat(101) })).toContain("too long");
  });

  it("rejects 1000 characters", () => {
    expect(fail({ name: "a".repeat(1000) })).toContain("too long");
  });

  it("trims and measures: 98 real chars within spaces is valid", () => {
    expect(() => ok({ name: `  ${"a".repeat(98)}  ` })).not.toThrow();
  });

  it("trims and measures: 102 real chars fails after trim", () => {
    expect(fail({ name: `  ${"a".repeat(102)}  ` })).toContain("too long");
  });

  it("accepts Unicode emoji in the name", () => {
    expect(() => ok({ name: "Yoga \uD83C\uDF3F Retreat" })).not.toThrow();
  });

  it("accepts CJK characters", () => {
    expect(() =>
      ok({ name: "\u30E8\u30AC\u30EA\u30C8\u30EA\u30FC\u30C8" }),
    ).not.toThrow();
  });

  it("accepts angle brackets verbatim (sanitisation is the UI's job)", () => {
    expect(() => ok({ name: '<script>alert("xss")</script>' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. client_domain normalisation and rejection
// ---------------------------------------------------------------------------

describe("client_domain boundaries", () => {
  it.each([
    ["yogaban.com", "yogaban.com"],
    ["https://www.yogaban.com/retreats/", "yogaban.com"],
    ["http://YOGABAN.COM:8080/path?q=1#top", "yogaban.com"],
    ["blog.yogaban.com", "blog.yogaban.com"],
    ["www.yogaban.co.uk", "yogaban.co.uk"],
  ])("normalises %s -> %s", (input, expected) => {
    expect(ok({ client_domain: input }).client_domain).toBe(expected);
  });

  it.each([
    "not a domain",
    "localhost",
    "192.168.1.1",
    "ftp://example.com",
    "example",
    "exa mple.com",
    "-bad-.com",
    "user:pass@example.com",
    "example.c",
  ])("rejects %j", (input) => {
    expect(fail({ client_domain: input })).toContain("not a valid domain");
  });

  it("empty string becomes null", () => {
    expect(ok({ client_domain: "" }).client_domain).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Country / language ISO normalisation
// ---------------------------------------------------------------------------

describe("country and language ISO code boundaries", () => {
  it("normalises lowercase country to uppercase", () => {
    expect(ok({ country: "in" }).country).toBe("IN");
  });

  it("normalises uppercase language to lowercase", () => {
    expect(ok({ language: "EN" }).language).toBe("en");
  });

  it("normalises mixed-case country", () => {
    expect(ok({ country: "Us" }).country).toBe("US");
  });

  it("rejects invalid country code ZZ", () => {
    expect(fail({ country: "ZZ" })).toContain("Choose a country");
  });

  it("rejects numeric country code", () => {
    expect(fail({ country: "99" })).toContain("Choose a country");
  });

  it("rejects invalid language code xx", () => {
    expect(fail({ language: "xx" })).toContain("Choose a language");
  });

  it("rejects 3-letter language code", () => {
    expect(fail({ language: "eng" })).toContain("Choose a language");
  });

  it("empty country becomes null", () => {
    expect(ok({ country: "" }).country).toBeNull();
  });

  it("empty language becomes null", () => {
    expect(ok({ language: "" }).language).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. budget_credits boundaries
// ---------------------------------------------------------------------------

describe("budget_credits boundaries", () => {
  it("accepts 0 (minimum)", () => {
    expect(ok({ budget_credits: "0" }).budget_credits).toBe(0);
  });

  it("accepts 1_000_000 (maximum)", () => {
    expect(ok({ budget_credits: "1000000" }).budget_credits).toBe(1_000_000);
  });

  it("rejects -1", () => {
    expect(fail({ budget_credits: "-1" })).toContain("at least 0");
  });

  it("rejects 1_000_001", () => {
    expect(fail({ budget_credits: "1000001" })).toContain("at most 1,000,000");
  });

  it("rejects a float", () => {
    expect(fail({ budget_credits: "500.5" })).toContain("whole number");
  });

  it("rejects alphabetic input", () => {
    expect(fail({ budget_credits: "many" })).toContain("must be a number");
  });

  it("treats whitespace as default (0)", () => {
    expect(ok({ budget_credits: "   " }).budget_credits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. pages_per_query boundaries (schema max = 10)
// ---------------------------------------------------------------------------

describe("pages_per_query boundaries", () => {
  it("accepts 1 (minimum)", () => {
    expect(ok({ pages_per_query: "1" }).pages_per_query).toBe(1);
  });

  it("accepts 10 (maximum)", () => {
    expect(ok({ pages_per_query: "10" }).pages_per_query).toBe(10);
  });

  it("rejects 0", () => {
    expect(fail({ pages_per_query: "0" })).toContain("at least 1");
  });

  it("rejects 11", () => {
    expect(fail({ pages_per_query: "11" })).toContain("at most 10");
  });
});

// ---------------------------------------------------------------------------
// 6. saturation_n and saturation_x
// ---------------------------------------------------------------------------

describe("saturation_n and saturation_x boundaries", () => {
  it("saturation_n: accepts 1 and 1000", () => {
    expect(ok({ saturation_n: "1" }).saturation_n).toBe(1);
    expect(ok({ saturation_n: "1000" }).saturation_n).toBe(1000);
  });

  it("saturation_x: accepts 0 and 1000", () => {
    expect(ok({ saturation_x: "0" }).saturation_x).toBe(0);
    expect(ok({ saturation_x: "1000" }).saturation_x).toBe(1000);
  });

  it("saturation_n: rejects 0 and 1001", () => {
    expect(fail({ saturation_n: "0" })).toContain("at least 1");
    expect(fail({ saturation_n: "1001" })).toContain("at most 1,000");
  });

  it("saturation_x: rejects -1 and 1001", () => {
    expect(fail({ saturation_x: "-1" })).toContain("at least 0");
    expect(fail({ saturation_x: "1001" })).toContain("at most 1,000");
  });

  it("(design intent) allows saturation_x > saturation_n at schema level", () => {
    // Runtime validation is deferred; the schema intentionally accepts this.
    expect(parse({ saturation_n: "5", saturation_x: "10" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. per_domain_cap and review_queue_size
// ---------------------------------------------------------------------------

describe("per_domain_cap and review_queue_size boundaries", () => {
  it("per_domain_cap: accepts 1 and 1000", () => {
    expect(ok({ per_domain_cap: "1" }).per_domain_cap).toBe(1);
    expect(ok({ per_domain_cap: "1000" }).per_domain_cap).toBe(1000);
  });

  it("per_domain_cap: rejects 0 and 1001", () => {
    expect(fail({ per_domain_cap: "0" })).toContain("at least 1");
    expect(fail({ per_domain_cap: "1001" })).toContain("at most 1,000");
  });

  it("review_queue_size: accepts 1 and 500", () => {
    expect(ok({ review_queue_size: "1" }).review_queue_size).toBe(1);
    expect(ok({ review_queue_size: "500" }).review_queue_size).toBe(500);
  });

  it("review_queue_size: rejects 0 and 501", () => {
    expect(fail({ review_queue_size: "0" })).toContain("at least 1");
    expect(fail({ review_queue_size: "501" })).toContain("at most 500");
  });

  it("scrape_credit_cap: accepts 0 and 1_000_000, rejects -1 and 1_000_001", () => {
    expect(ok({ scrape_credit_cap: "0" }).scrape_credit_cap).toBe(0);
    expect(ok({ scrape_credit_cap: "1000000" }).scrape_credit_cap).toBe(
      1_000_000,
    );
    expect(fail({ scrape_credit_cap: "-1" })).toContain("at least 0");
    expect(fail({ scrape_credit_cap: "1000001" })).toContain(
      "at most 1,000,000",
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Draft semantics — defaults
// ---------------------------------------------------------------------------

describe("draft save semantics", () => {
  it("saves with only a name (full draft)", () => {
    expect(parse().success).toBe(true);
  });

  it("sets all arrays to empty", () => {
    const d = ok();
    expect(d.target_urls).toEqual([]);
    expect(d.seed_keywords).toEqual([]);
    expect(d.activity_keys).toEqual([]);
    expect(d.competitor_domains).toEqual([]);
    expect(d.reference_sites).toEqual([]);
    expect(d.seed_list_urls).toEqual([]);
    expect(d.banned_categories).toEqual([]);
    expect(d.blocked_domains).toEqual([]);
  });

  it("sets number fields to their defaults", () => {
    const d = ok();
    expect(d.budget_credits).toBe(0);
    expect(d.pages_per_query).toBe(1);
    expect(d.saturation_n).toBe(20);
    expect(d.saturation_x).toBe(3);
    expect(d.per_domain_cap).toBe(10);
    expect(d.review_queue_size).toBe(50);
    expect(d.scrape_credit_cap).toBe(0);
  });

  it("optional text fields default to null", () => {
    const d = ok();
    expect(d.client).toBeNull();
    expect(d.client_domain).toBeNull();
    expect(d.country).toBeNull();
    expect(d.language).toBeNull();
    expect(d.business_type).toBeNull();
    expect(d.sub_niche).toBeNull();
    expect(d.local_business).toBeNull();
  });

  it("booleans default to false", () => {
    const d = ok();
    expect(d.require_language_region_match).toBe(false);
    expect(d.skip_previously_spam_domains).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. target_urls normalisation
// ---------------------------------------------------------------------------

describe("target_urls normalisation edge cases", () => {
  it("adds https:// when no scheme is provided", () => {
    expect(ok({ target_urls: ["yogaban.com/retreats"] }).target_urls).toEqual([
      "https://yogaban.com/retreats",
    ]);
  });

  it("strips fragment but keeps query string", () => {
    expect(
      ok({ target_urls: ["https://yogaban.com/page?x=1#top"] }).target_urls,
    ).toEqual(["https://yogaban.com/page?x=1"]);
  });

  it("strips trailing slash on bare root", () => {
    expect(ok({ target_urls: ["https://yogaban.com/"] }).target_urls).toEqual([
      "https://yogaban.com",
    ]);
  });

  it("keeps trailing slash when there is a query string", () => {
    expect(
      ok({ target_urls: ["https://yogaban.com/?promo=1"] }).target_urls,
    ).toEqual(["https://yogaban.com/?promo=1"]);
  });

  it("deduplicates URLs normalised to the same value", () => {
    expect(
      ok({
        target_urls: [
          "yogaban.com/retreats#top",
          "HTTPS://yogaban.com/retreats",
        ],
      }).target_urls,
    ).toEqual(["https://yogaban.com/retreats"]);
  });

  it.each([
    "http://192.168.1.1/admin",
    "http://localhost:3000/x",
    "javascript:alert(1)",
    "ftp://files.yogaban.com/x",
    "https://user:pass@yogaban.com/page",
  ])("rejects unsafe URL %j", (input) => {
    expect(fail({ target_urls: [input] })).toContain("not a valid web address");
  });

  it("rejects a very long URL (> 2048 chars)", () => {
    const long = `https://yogaban.com/${"a".repeat(2100)}`;
    expect(fail({ target_urls: [long] })).toContain("not a valid web address");
  });
});

// ---------------------------------------------------------------------------
// 10. Domain list dirty-input normalisation
// ---------------------------------------------------------------------------

describe("competitor_domains dirty-input normalisation", () => {
  it("strips https://, www., path and query", () => {
    expect(
      ok({
        competitor_domains: ["https://www.Rival.com/page?x=1", "RIVAL.com"],
      }).competitor_domains,
    ).toEqual(["rival.com"]);
  });

  it("strips trailing dots", () => {
    expect(ok({ reference_sites: ["example.com."] }).reference_sites).toEqual([
      "example.com",
    ]);
  });

  it("rejects domains with a space in the middle", () => {
    expect(fail({ competitor_domains: ["exa mple.com"] })).toContain(
      "not a valid domain",
    );
  });

  it("rejects IP addresses as competitor domains", () => {
    expect(fail({ competitor_domains: ["192.168.0.1"] })).toContain(
      "not a valid domain",
    );
  });
});

// ---------------------------------------------------------------------------
// 11. seed_keywords cleaning
// ---------------------------------------------------------------------------

describe("seed_keywords cleaning", () => {
  it("collapses internal whitespace", () => {
    expect(ok({ seed_keywords: ["yoga   retreat"] }).seed_keywords).toEqual([
      "yoga retreat",
    ]);
  });

  it("lowercases all keywords", () => {
    expect(
      ok({ seed_keywords: ["Yoga Retreat", "BALI"] }).seed_keywords,
    ).toEqual(["yoga retreat", "bali"]);
  });

  it("deduplicates case-insensitively", () => {
    expect(
      ok({
        seed_keywords: ["Yoga Retreat", "yoga retreat", "YOGA RETREAT"],
      }).seed_keywords,
    ).toEqual(["yoga retreat"]);
  });

  it("drops blank entries silently", () => {
    expect(
      ok({ seed_keywords: ["yoga", "", "  ", "bali"] }).seed_keywords,
    ).toEqual(["yoga", "bali"]);
  });

  it("rejects a keyword exceeding 100 characters", () => {
    expect(fail({ seed_keywords: ["a".repeat(101)] })).toContain("too long");
  });
});

// ---------------------------------------------------------------------------
// 12. local_business comprehensive edge cases
// ---------------------------------------------------------------------------

describe("local_business edge cases", () => {
  it("returns null when only whitespace is entered in all fields", () => {
    expect(
      ok({
        local_business_name: "   ",
        local_business_address: "  ",
        local_business_phone: "  ",
      }).local_business,
    ).toBeNull();
  });

  it("trims name and address", () => {
    const lb = ok({
      local_business_name: "  Yogaban Studio  ",
      local_business_address: "  123 Main St  ",
    }).local_business;
    expect(lb?.name).toBe("Yogaban Studio");
    expect(lb?.address).toBe("123 Main St");
  });

  it("rejects business name > 150 chars", () => {
    expect(fail({ local_business_name: "a".repeat(151) })).toContain(
      "too long",
    );
  });

  it("rejects address > 300 chars", () => {
    expect(fail({ local_business_address: "a".repeat(301) })).toContain(
      "too long",
    );
  });

  it.each(["+91 98765 43210", "+1 (800) 555-0100", "0044 20 7946 0000"])(
    "accepts international phone format %s",
    (phone) => {
      expect(() => ok({ local_business_phone: phone })).not.toThrow();
    },
  );

  it("rejects phone with letters", () => {
    expect(fail({ local_business_phone: "call me maybe" })).toContain(
      "not valid",
    );
  });

  it("rejects a very short phone (< 5 chars)", () => {
    expect(fail({ local_business_phone: "123" })).toContain("not valid");
  });
});

// ---------------------------------------------------------------------------
// 13. activity_keys validation
// ---------------------------------------------------------------------------

describe("activity_keys validation", () => {
  it("accepts valid snake_case keys", () => {
    expect(
      ok({ activity_keys: ["guest_post", "resource_page"] }).activity_keys,
    ).toEqual(["guest_post", "resource_page"]);
  });

  it("sorts keys to avoid phantom config changes", () => {
    expect(
      ok({ activity_keys: ["resource_page", "guest_post"] }).activity_keys,
    ).toEqual(["guest_post", "resource_page"]);
  });

  it("deduplicates keys", () => {
    expect(
      ok({ activity_keys: ["guest_post", "guest_post"] }).activity_keys,
    ).toEqual(["guest_post"]);
  });

  it("rejects keys with uppercase letters", () => {
    expect(parse({ activity_keys: ["Guest_Post"] }).success).toBe(false);
  });

  it("rejects keys with spaces", () => {
    expect(parse({ activity_keys: ["guest post"] }).success).toBe(false);
  });

  it("rejects a key starting with a digit", () => {
    expect(parse({ activity_keys: ["1guest"] }).success).toBe(false);
  });

  it("rejects more than 20 activity keys", () => {
    const keys = Array.from({ length: 21 }, (_, i) => `act${i}_post`);
    expect(fail({ activity_keys: keys })).toContain("Too many activities");
  });
});

// ---------------------------------------------------------------------------
// 14. Cross-field: client cannot be its own competitor
// ---------------------------------------------------------------------------

describe("client-vs-competitor cross-field rule", () => {
  it("rejects when competitor list contains the client domain after normalisation", () => {
    expect(
      fail({
        client_domain: "yogaban.com",
        competitor_domains: ["rival.com", "www.yogaban.com"],
      }),
    ).toContain("cannot also be a competitor");
  });

  it("accepts when client is not among competitors", () => {
    expect(() =>
      ok({
        client_domain: "yogaban.com",
        competitor_domains: ["rival.com", "other.net"],
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 15. banned_categories and regions text list constraints
// ---------------------------------------------------------------------------

describe("banned_categories and regions boundaries", () => {
  it("lowercases banned categories", () => {
    expect(
      ok({ banned_categories: ["Casino", "GAMBLING"] }).banned_categories,
    ).toEqual(["casino", "gambling"]);
  });

  it("rejects a category exceeding 60 characters", () => {
    expect(fail({ banned_categories: ["a".repeat(61)] })).toContain("too long");
  });

  it("regions are preserved in original case", () => {
    expect(ok({ regions: ["Rishikesh", "Goa"] }).regions).toEqual([
      "Rishikesh",
      "Goa",
    ]);
  });

  it("rejects a region exceeding 80 characters", () => {
    expect(fail({ regions: ["a".repeat(81)] })).toContain("too long");
  });

  it("deduplicates regions case-insensitively", () => {
    expect(ok({ regions: ["Goa", "GOA", "goa"] }).regions).toEqual(["Goa"]);
  });
});
