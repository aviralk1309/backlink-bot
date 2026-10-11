import { describe, expect, it } from "vitest";
import { cloneName, enforceLocked, lockedPermissions } from "./rules";

describe("lockedPermissions", () => {
  it("locks nothing for an ordinary role you do not hold", () => {
    expect(lockedPermissions({ isProtected: false, isOwnRole: false })).toEqual(
      {},
    );
  });
  it("locks roles.manage on your own role", () => {
    expect(lockedPermissions({ isProtected: false, isOwnRole: true })).toEqual({
      "roles.manage": "Your own role must keep this.",
    });
  });
  it("locks both admin keys on a protected role", () => {
    const locked = lockedPermissions({ isProtected: true, isOwnRole: false });
    expect(Object.keys(locked).sort()).toEqual([
      "roles.manage",
      "users.manage",
    ]);
  });
  it("prefers the Admin reason when both apply", () => {
    const locked = lockedPermissions({ isProtected: true, isOwnRole: true });
    expect(locked["roles.manage"]).toBe("Required for the Admin role.");
  });
});

describe("enforceLocked", () => {
  it("adds locked keys without mutating the input", () => {
    const start = new Set(["jobs.view"]);
    const next = enforceLocked(start, { "roles.manage": "x" });
    expect([...next].sort()).toEqual(["jobs.view", "roles.manage"]);
    expect([...start]).toEqual(["jobs.view"]);
  });
  it("changes nothing when there is nothing locked", () => {
    expect([...enforceLocked(new Set(["a"]), {})]).toEqual(["a"]);
  });
});

describe("cloneName", () => {
  it("appends the suffix", () => {
    expect(cloneName("Auditor")).toBe("Auditor (copy)");
  });
  it("trims whitespace", () => {
    expect(cloneName("  Auditor  ")).toBe("Auditor (copy)");
  });
  it("stays within 50 characters for long names", () => {
    const out = cloneName("x".repeat(50));
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith(" (copy)")).toBe(true);
  });
});
