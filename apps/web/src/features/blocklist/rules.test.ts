import { describe, expect, it } from "vitest";
import {
  MAX_BATCH,
  addSummary,
  blocklistHref,
  parseBlocklistParams,
  parseDomainBatch,
} from "./rules";

describe("parseDomainBatch", () => {
  it("cleans, splits and dedupes a pasted list", () => {
    expect(
      parseDomainBatch(
        "https://www.Spam.com/page, other.net\nSPAM.com  third.org;fourth.io",
      ),
    ).toEqual({
      ok: true,
      domains: ["spam.com", "other.net", "third.org", "fourth.io"],
    });
  });

  it("asks for something when empty", () => {
    expect(parseDomainBatch("  \n ,; ")).toEqual({
      ok: false,
      error: "Enter at least one domain.",
    });
  });

  it("stops at a bad entry and names it", () => {
    const r = parseDomainBatch("good.com notadomain");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("notadomain");
  });

  it("rejects addresses that are not registered-looking domains", () => {
    for (const bad of [
      "localhost",
      "192.168.0.1",
      "a_b.com",
      "mailto:a@b.com",
    ]) {
      expect(parseDomainBatch(bad).ok, bad).toBe(false);
    }
  });

  it("limits the batch size", () => {
    const many = Array.from(
      { length: MAX_BATCH + 1 },
      (_, i) => `site${i}.com`,
    );
    expect(parseDomainBatch(many.join(" ")).ok).toBe(false);
    expect(parseDomainBatch(many.slice(1).join(" ")).ok).toBe(true);
  });
});

describe("parseBlocklistParams and blocklistHref", () => {
  it("defaults and clamps", () => {
    expect(parseBlocklistParams({})).toEqual({ q: "", page: 1 });
    expect(parseBlocklistParams({ page: "-3" }).page).toBe(1);
    expect(parseBlocklistParams({ page: "abc" }).page).toBe(1);
    expect(parseBlocklistParams({ q: "a%b,(c)" }).q).toBe("a b c");
  });

  it("builds short links", () => {
    expect(blocklistHref({})).toBe("/admin/blocklist");
    expect(blocklistHref({ q: "spam", page: 2 })).toBe(
      "/admin/blocklist?q=spam&page=2",
    );
  });
});

describe("addSummary", () => {
  it.each([
    [3, 0, "Added 3 domains."],
    [1, 0, "Added 1 domain."],
    [3, 2, "Added 3 domains. 2 were already blocked."],
    [2, 1, "Added 2 domains. 1 was already blocked."],
    [0, 1, "That domain was already blocked."],
    [0, 4, "All 4 domains were already blocked."],
  ])("%i added, %i skipped", (added, skipped, text) => {
    expect(addSummary(added, skipped)).toBe(text);
  });
});
