import { describe, expect, it } from "vitest";
import { savedNotice } from "./notice";

describe("savedNotice", () => {
  it("maps the three outcomes", () => {
    expect(savedNotice("created")).toBe("Role created.");
    expect(savedNotice("updated")).toBe("Role saved.");
    expect(savedNotice("deleted")).toBe("Role deleted.");
  });
  it("ignores missing and unknown values", () => {
    expect(savedNotice(undefined)).toBeNull();
    expect(savedNotice("")).toBeNull();
    expect(savedNotice("<script>")).toBeNull();
  });
  it("ignores inherited object keys", () => {
    expect(savedNotice("constructor")).toBeNull();
    expect(savedNotice("toString")).toBeNull();
  });
});
