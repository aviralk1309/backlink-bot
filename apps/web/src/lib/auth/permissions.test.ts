import { describe, expect, it } from "vitest";
import { isAllowed } from "./permissions";

describe("isAllowed", () => {
  const held = ["jobs.view", "reports.view"];

  it("allows a held permission", () => {
    expect(isAllowed(held, "jobs.view")).toBe(true);
  });
  it("denies a missing permission", () => {
    expect(isAllowed(held, "jobs.create")).toBe(false);
  });
  it("denies everything when nothing is held", () => {
    expect(isAllowed([], "jobs.view")).toBe(false);
    expect(isAllowed([], { anyOf: ["jobs.view"] })).toBe(false);
  });
  it("allows anyOf when one key is held", () => {
    expect(isAllowed(held, { anyOf: ["users.manage", "reports.view"] })).toBe(
      true,
    );
  });
  it("denies anyOf when no key is held", () => {
    expect(isAllowed(held, { anyOf: ["users.manage", "roles.manage"] })).toBe(
      false,
    );
  });
  it("denies an empty anyOf", () => {
    expect(isAllowed(held, { anyOf: [] })).toBe(false);
  });
  it("does not match on prefixes or an empty key", () => {
    expect(isAllowed(held, "jobs")).toBe(false);
    expect(isAllowed(held, "")).toBe(false);
  });
});
