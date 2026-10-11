import { describe, expect, it } from "vitest";
import { visibleAdminSections } from "./admin-nav";

const hrefs = (perms: string[]) =>
  visibleAdminSections(perms).map((s) => s.href);

describe("visibleAdminSections", () => {
  it("shows both sections to someone with both permissions", () => {
    expect(hrefs(["users.manage", "roles.manage"])).toEqual([
      "/admin/users",
      "/admin/roles",
    ]);
  });
  it("shows only what the user can manage", () => {
    expect(hrefs(["roles.manage"])).toEqual(["/admin/roles"]);
    expect(hrefs(["users.manage"])).toEqual(["/admin/users"]);
  });
  it("shows nothing without admin permissions", () => {
    expect(hrefs(["jobs.view", "results.view"])).toEqual([]);
    expect(hrefs([])).toEqual([]);
  });
});
