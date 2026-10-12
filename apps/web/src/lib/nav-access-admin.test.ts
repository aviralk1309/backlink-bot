import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS } from "./admin-nav";
import { visibleNavItems } from "./nav-access";

const labels = (perms: string[]) => visibleNavItems(perms).map((i) => i.label);

describe("the Admin link", () => {
  it.each(ADMIN_SECTIONS.map((s) => s.permission))(
    "shows for %s alone",
    (permission) => {
      expect(labels([permission])).toContain("Admin");
    },
  );

  it("stays hidden without any admin permission", () => {
    expect(labels(["jobs.view", "reports.view"])).not.toContain("Admin");
  });
});
