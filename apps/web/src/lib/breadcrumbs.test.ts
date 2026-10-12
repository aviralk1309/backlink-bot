import { describe, expect, it } from "vitest";
import { breadcrumbsFor } from "./breadcrumbs";

describe("breadcrumbsFor", () => {
  it("returns only Home for the root", () => {
    expect(breadcrumbsFor("/")).toEqual([{ label: "Home", href: "/" }]);
  });

  it("builds a crumb per segment with cumulative hrefs", () => {
    expect(breadcrumbsFor("/admin/roles/new")).toEqual([
      { label: "Home", href: "/" },
      { label: "Admin", href: "/admin" },
      { label: "Roles", href: "/admin/roles" },
      { label: "New", href: "/admin/roles/new" },
    ]);
  });

  it("labels unknown segments such as ids as Details", () => {
    const crumbs = breadcrumbsFor("/admin/roles/0b6f1c1e");
    expect(crumbs.at(-1)).toEqual({
      label: "Details",
      href: "/admin/roles/0b6f1c1e",
    });
  });

  it("labels job edit paths", () => {
    expect(breadcrumbsFor("/jobs/7c1a/edit").map((c) => c.label)).toEqual([
      "Home",
      "Jobs",
      "Details",
      "Edit",
    ]);
  });
});
