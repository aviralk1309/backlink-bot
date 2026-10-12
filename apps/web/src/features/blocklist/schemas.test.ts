import { describe, expect, it } from "vitest";
import {
  addBlocklistSchema,
  removeBlocklistSchema,
  updateReasonSchema,
} from "./schemas";

const ID = "11111111-1111-4111-8111-111111111111";

describe("addBlocklistSchema", () => {
  it("returns clean domains and a null reason when blank", () => {
    const r = addBlocklistSchema.parse({
      domains: "A.com b.net",
      reason: "  ",
    });
    expect(r).toEqual({ domains: ["a.com", "b.net"], reason: null });
  });

  it("trims the reason", () => {
    expect(
      addBlocklistSchema.parse({ domains: "a.com", reason: " spammy " }).reason,
    ).toBe("spammy");
  });

  it("limits the reason", () => {
    const r = addBlocklistSchema.safeParse({
      domains: "a.com",
      reason: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("reports a bad domain and a missing field", () => {
    const bad = addBlocklistSchema.safeParse({ domains: "nope" });
    expect(!bad.success && bad.error.issues[0]?.message).toContain("nope");
    const missing = addBlocklistSchema.safeParse({});
    expect(!missing.success && missing.error.issues[0]?.message).toContain(
      "Enter at least one domain",
    );
  });
});

describe("row schemas", () => {
  it("need a valid id", () => {
    expect(updateReasonSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(removeBlocklistSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(removeBlocklistSchema.safeParse({ id: ID }).success).toBe(true);
  });

  it("allow clearing the reason", () => {
    expect(updateReasonSchema.parse({ id: ID, reason: "" }).reason).toBeNull();
    expect(updateReasonSchema.parse({ id: ID }).reason).toBeNull();
  });
});
