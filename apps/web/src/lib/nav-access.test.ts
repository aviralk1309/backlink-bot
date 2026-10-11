import { describe, expect, it } from "vitest";
import { visibleNavItems } from "./nav-access";

const labels = (perms: string[]) => visibleNavItems(perms).map((i) => i.label);

describe("visibleNavItems", () => {
  it("shows nothing without permissions", () => {
    expect(labels([])).toEqual([]);
  });

  it("matches the starter roles", () => {
    expect(labels(["jobs.view", "results.view", "reports.view"])).toEqual([
      "Jobs",
      "Reports",
    ]);
    expect(labels(["users.manage", "jobs.view", "reports.view"])).toEqual([
      "Jobs",
      "Reports",
      "Admin",
    ]);
  });

  it("shows Admin for either management permission", () => {
    expect(labels(["roles.manage"])).toEqual(["Admin"]);
    expect(labels(["users.manage"])).toEqual(["Admin"]);
  });
});
