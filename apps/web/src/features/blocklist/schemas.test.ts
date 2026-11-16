import { describe, expect, it } from "vitest";
import {
  addBlocklistSchema,
  blockFromReviewSchema,
  removeBlocklistSchema,
  undoReviewBlockSchema,
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

describe("review blocklist input", () => {
  it("accepts one rejected result or one domain with a required reason", () => {
    expect(
      blockFromReviewSchema.parse({
        jobId: ID,
        resultId: ID,
        reason: "  Spam  ",
      }).reason,
    ).toBe("Spam");
    expect(
      blockFromReviewSchema.safeParse({
        jobId: ID,
        domain: "spam.example",
        reason: "Rejected in job",
      }).success,
    ).toBe(true);
  });

  it("rejects ambiguous sources, blank reasons and malformed domains", () => {
    expect(
      blockFromReviewSchema.safeParse({ jobId: ID, reason: "Spam" }).success,
    ).toBe(false);
    expect(
      blockFromReviewSchema.safeParse({
        jobId: ID,
        resultId: ID,
        domain: "spam.example",
        reason: "Spam",
      }).success,
    ).toBe(false);
    expect(
      blockFromReviewSchema.safeParse({
        jobId: ID,
        domain: "https://spam.example/path",
        reason: " ",
      }).success,
    ).toBe(false);
  });

  it("binds undo to the recorded entry and reason", () => {
    expect(
      undoReviewBlockSchema.safeParse({
        id: ID,
        jobId: ID,
        domain: "spam.example",
        reason: "Spam",
      }).success,
    ).toBe(true);
    expect(
      undoReviewBlockSchema.safeParse({
        id: ID,
        jobId: ID,
        domain: "spam.example",
        reason: "",
      }).success,
    ).toBe(false);
  });
});
