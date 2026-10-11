import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

describe("safeNext", () => {
  it("keeps same-origin paths with query strings", () => {
    expect(safeNext("/jobs?status=running")).toBe("/jobs?status=running");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "jobs",
    "/ok\nSet-Cookie: x=1",
  ])("rejects %j", (value) => {
    expect(safeNext(value)).toBe("/");
  });

  it("falls back for empty input and honors a custom fallback", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined, "/set-password")).toBe("/set-password");
  });
});
