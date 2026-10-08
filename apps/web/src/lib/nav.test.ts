// src/lib/nav.test.ts
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav";

describe("nav", () => {
  it("has Jobs, Reports, Admin", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Jobs", "Reports", "Admin"]);
  });
});
