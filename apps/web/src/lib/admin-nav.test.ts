import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, visibleAdminSections } from "./admin-nav";

const hrefs = (perms: string[]) =>
  visibleAdminSections(perms).map((s) => s.href);

describe("visibleAdminSections", () => {
  it("shows every section to someone with every permission", () => {
    expect(
      hrefs([
        "users.manage",
        "roles.manage",
        "activities.manage",
        "blocklist.manage",
      ]),
    ).toEqual([
      "/admin/users",
      "/admin/roles",
      "/admin/activities",
      "/admin/blocklist",
    ]);
  });

  it("shows only what the user can manage", () => {
    expect(hrefs(["roles.manage"])).toEqual(["/admin/roles"]);
    expect(hrefs(["users.manage"])).toEqual(["/admin/users"]);
    expect(hrefs(["activities.manage"])).toEqual(["/admin/activities"]);
    expect(hrefs(["blocklist.manage"])).toEqual(["/admin/blocklist"]);
  });

  it("shows nothing without admin permissions", () => {
    expect(hrefs(["jobs.view", "results.view"])).toEqual([]);
    expect(hrefs([])).toEqual([]);
  });

  it("has one section per permission", () => {
    const perms = ADMIN_SECTIONS.map((s) => s.permission);
    expect(new Set(perms).size).toBe(perms.length);
  });
});
