/**
 * Phase 4 QA: Blocklist — Dirty-input Normalisation & Boundary Value Analysis
 *
 * Exhaustively tests parseDomainBatch, addBlocklistSchema, and the
 * updateReasonSchema with bulk-paste edge cases, limit enforcement,
 * and deduplication behaviour.
 */
import { describe, expect, it } from "vitest";
import { MAX_BATCH, REASON_MAX, addSummary, parseDomainBatch } from "./rules";
import {
  addBlocklistSchema,
  removeBlocklistSchema,
  updateReasonSchema,
} from "./schemas";

const ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// 1. parseDomainBatch — dirty-input normalisation
// ---------------------------------------------------------------------------

describe("parseDomainBatch — dirty-input normalisation", () => {
  it("strips https:// prefix and normalises to lowercase", () => {
    expect(parseDomainBatch("https://Spam.com")).toEqual({
      ok: true,
      domains: ["spam.com"],
    });
  });

  it("strips http:// prefix", () => {
    expect(parseDomainBatch("http://other.net")).toEqual({
      ok: true,
      domains: ["other.net"],
    });
  });

  it("strips www. prefix", () => {
    expect(parseDomainBatch("www.example.com")).toEqual({
      ok: true,
      domains: ["example.com"],
    });
  });

  it("strips path, query and fragment from a URL", () => {
    expect(parseDomainBatch("https://example.com/path?q=1#top")).toEqual({
      ok: true,
      domains: ["example.com"],
    });
  });

  it("strips trailing slash", () => {
    expect(parseDomainBatch("example.com/")).toEqual({
      ok: true,
      domains: ["example.com"],
    });
  });

  it("normalises uppercase domains to lowercase", () => {
    expect(parseDomainBatch("SPAM.COM")).toEqual({
      ok: true,
      domains: ["spam.com"],
    });
  });

  it("strips trailing dot from domain", () => {
    expect(parseDomainBatch("example.com.")).toEqual({
      ok: true,
      domains: ["example.com"],
    });
  });

  it("handles mixed newlines, commas and semicolons as separators", () => {
    const r = parseDomainBatch("a.com,b.net;c.org\nd.io\r\ne.co");
    expect(r).toEqual({
      ok: true,
      domains: ["a.com", "b.net", "c.org", "d.io", "e.co"],
    });
  });

  it("handles tabs as separators", () => {
    const r = parseDomainBatch("a.com\tb.net");
    expect(r).toEqual({ ok: true, domains: ["a.com", "b.net"] });
  });

  it("deduplicates after normalisation (same domain, different cases)", () => {
    const r = parseDomainBatch("Spam.com\nSPAM.COM\nspam.com");
    expect(r).toEqual({ ok: true, domains: ["spam.com"] });
  });

  it("deduplicates www and non-www versions (both normalise to bare domain)", () => {
    // www.spam.com → spam.com (when a second label follows)
    const r = parseDomainBatch("www.spam.com spam.com");
    expect(r).toEqual({ ok: true, domains: ["spam.com"] });
  });

  it("handles unicode / IDN domains", () => {
    const r = parseDomainBatch("münchen.de");
    expect(r).toEqual({ ok: true, domains: ["xn--mnchen-3ya.de"] });
  });

  it("drops empty entries between separators", () => {
    const r = parseDomainBatch("a.com,,  ,,b.net");
    expect(r).toEqual({ ok: true, domains: ["a.com", "b.net"] });
  });
});

// ---------------------------------------------------------------------------
// 2. parseDomainBatch — rejected inputs
// ---------------------------------------------------------------------------

describe("parseDomainBatch — rejected inputs", () => {
  it("returns an error for empty input", () => {
    expect(parseDomainBatch("  \n ,; \t ")).toEqual({
      ok: false,
      error: "Enter at least one domain.",
    });
  });

  it("stops at the first bad entry and names it", () => {
    const r = parseDomainBatch("good.com notadomain second.org");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("notadomain");
  });

  it("rejects localhost", () => {
    expect(parseDomainBatch("localhost").ok).toBe(false);
  });

  it("rejects bare IP addresses", () => {
    for (const ip of ["192.168.0.1", "10.0.0.1", "127.0.0.1"]) {
      expect(parseDomainBatch(ip).ok, ip).toBe(false);
    }
  });

  it("rejects single-label hosts (no TLD)", () => {
    expect(parseDomainBatch("example").ok).toBe(false);
  });

  it("rejects domains with underscores", () => {
    expect(parseDomainBatch("a_b.com").ok).toBe(false);
  });

  it("rejects domains that start or end with a hyphen", () => {
    expect(parseDomainBatch("-bad.com").ok).toBe(false);
    expect(parseDomainBatch("bad-.com").ok).toBe(false);
  });

  it("rejects mailto: URIs", () => {
    expect(parseDomainBatch("mailto:user@example.com").ok).toBe(false);
  });

  it("rejects ftp:// URIs", () => {
    expect(parseDomainBatch("ftp://example.com").ok).toBe(false);
  });

  it("rejects URLs with credentials", () => {
    expect(parseDomainBatch("https://user:pass@example.com").ok).toBe(false);
  });

  it("rejects a domain with a TLD that is too short (single letter)", () => {
    expect(parseDomainBatch("example.c").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. parseDomainBatch — size limit
// ---------------------------------------------------------------------------

describe("parseDomainBatch — batch size limit", () => {
  it(`rejects more than ${MAX_BATCH} domains`, () => {
    const tooMany = Array.from(
      { length: MAX_BATCH + 1 },
      (_, i) => `site${i}.com`,
    );
    expect(parseDomainBatch(tooMany.join("\n")).ok).toBe(false);
  });

  it(`accepts exactly ${MAX_BATCH} domains`, () => {
    const exactly = Array.from({ length: MAX_BATCH }, (_, i) => `site${i}.com`);
    expect(parseDomainBatch(exactly.join("\n")).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. addBlocklistSchema — reason field boundaries
// ---------------------------------------------------------------------------

describe("addBlocklistSchema — reason field boundaries", () => {
  it("accepts an empty reason and returns null", () => {
    const r = addBlocklistSchema.parse({ domains: "a.com", reason: "" });
    expect(r.reason).toBeNull();
  });

  it("trims whitespace-only reason to null", () => {
    const r = addBlocklistSchema.parse({ domains: "a.com", reason: "   " });
    expect(r.reason).toBeNull();
  });

  it("trims leading and trailing whitespace from a reason", () => {
    const r = addBlocklistSchema.parse({
      domains: "a.com",
      reason: "  spammy  ",
    });
    expect(r.reason).toBe("spammy");
  });

  it(`accepts a reason of exactly ${REASON_MAX} characters`, () => {
    const r = addBlocklistSchema.safeParse({
      domains: "a.com",
      reason: "x".repeat(REASON_MAX),
    });
    expect(r.success).toBe(true);
  });

  it(`rejects a reason of ${REASON_MAX + 1} characters`, () => {
    const r = addBlocklistSchema.safeParse({
      domains: "a.com",
      reason: "x".repeat(REASON_MAX + 1),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("too long");
  });

  it("returns a meaningful error when domains are missing entirely", () => {
    const r = addBlocklistSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toContain("Enter at least one domain");
  });
});

// ---------------------------------------------------------------------------
// 5. updateReasonSchema and removeBlocklistSchema
// ---------------------------------------------------------------------------

describe("row schemas — ID validation", () => {
  it("updateReasonSchema: rejects a non-UUID id", () => {
    expect(
      updateReasonSchema.safeParse({ id: "not-a-uuid", reason: "" }).success,
    ).toBe(false);
  });

  it("updateReasonSchema: accepts a valid UUID and nulls an empty reason", () => {
    const r = updateReasonSchema.parse({ id: ID, reason: "" });
    expect(r.id).toBe(ID);
    expect(r.reason).toBeNull();
  });

  it("updateReasonSchema: accepts an undefined reason as null", () => {
    const r = updateReasonSchema.parse({ id: ID });
    expect(r.reason).toBeNull();
  });

  it("removeBlocklistSchema: rejects a non-UUID id", () => {
    expect(removeBlocklistSchema.safeParse({ id: "x" }).success).toBe(false);
  });

  it("removeBlocklistSchema: accepts a valid UUID", () => {
    expect(removeBlocklistSchema.safeParse({ id: ID }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. addSummary — all branches
// ---------------------------------------------------------------------------

describe("addSummary all branches", () => {
  it.each([
    [1, 0, "Added 1 domain."],
    [5, 0, "Added 5 domains."],
    [3, 1, "Added 3 domains. 1 was already blocked."],
    [3, 2, "Added 3 domains. 2 were already blocked."],
    [0, 1, "That domain was already blocked."],
    [0, 2, "All 2 domains were already blocked."],
    [0, 10, "All 10 domains were already blocked."],
  ])("%i added, %i skipped -> %s", (added, skipped, expected) => {
    expect(addSummary(added, skipped)).toBe(expected);
  });
});
