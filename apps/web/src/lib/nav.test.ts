// src/lib/nav.test.ts
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav";

describe("nav", () => {
  it("has only implemented destinations", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Jobs", "Reports", "Admin"]);
  });
});
