import { describe, expect, it } from "vitest";
import {
  defaultConfig,
  renderTemplate,
  sortTemplates,
  suggestKey,
  templateProblem,
  weightsTotal,
} from "./rules";

describe("templateProblem", () => {
  it.each([
    "{keyword}",
    '"write for us" {keyword}',
    "intitle:resources {keyword} {city}",
    "  {niche}   inurl:links ",
  ])("accepts %s", (t) => {
    expect(templateProblem(t)).toBeNull();
  });

  it("asks for text", () => {
    expect(templateProblem("   ")).toContain("Enter the search text");
  });

  it("asks for at least one placeholder", () => {
    expect(templateProblem('"write for us"')).toContain(
      "at least one placeholder",
    );
  });

  it("names an unknown placeholder", () => {
    expect(templateProblem("{keywrd} guest post")).toContain("{keywrd}");
    expect(templateProblem("{} guest post")).toContain("{}");
  });

  it("rejects a stray brace", () => {
    expect(templateProblem("{keyword} {oops")).toContain("curly brace");
    expect(templateProblem("keyword} {keyword}")).toContain("curly brace");
  });

  it("limits the length", () => {
    expect(templateProblem(`{keyword} ${"a".repeat(300)}`)).toContain(
      "too long",
    );
  });
});

describe("renderTemplate", () => {
  it("fills the sample values", () => {
    expect(renderTemplate('"write for us"  {keyword}')).toBe(
      '"write for us" yoga retreat',
    );
  });

  it("leaves unknown placeholders alone", () => {
    expect(renderTemplate("{nope} {city}")).toBe("{nope} Pune");
  });
});

describe("sortTemplates", () => {
  const t = (id: string, priority: number) => ({
    id,
    template: "{keyword}",
    language: "*",
    priority,
    enabled: true,
  });

  it("orders by priority and keeps ties in order", () => {
    expect(
      sortTemplates([t("c", 2), t("a", 1), t("b", 2)]).map((x) => x.id),
    ).toEqual(["a", "c", "b"]);
  });
});

describe("weightsTotal", () => {
  it("adds the five positive parts and ignores the spam penalty", () => {
    expect(weightsTotal(defaultConfig().scoring_weights)).toBe(100);
  });
});

describe("suggestKey", () => {
  it.each([
    ["Guest post", "guest_post"],
    ["  Resource page! ", "resource_page"],
    ["2024 guide", "guide"],
    ["x", ""],
    ["日本語", ""],
  ])("%s -> %s", (name, key) => {
    expect(suggestKey(name)).toBe(key);
  });
});
