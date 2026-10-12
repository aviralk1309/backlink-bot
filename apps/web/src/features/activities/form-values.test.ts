import { describe, expect, it } from "vitest";
import {
  formWeightsTotal,
  nextPriority,
  toNumber,
  configToForm,
} from "./form-values";
import { defaultConfig } from "./rules";

describe("toNumber", () => {
  it("never turns blank into 0", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("  ")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber("12")).toBe(12);
    expect(toNumber(" 0.25 ")).toBe(0.25);
    expect(toNumber("Infinity")).toBeNull();
  });
});

describe("nextPriority", () => {
  const row = (priority: string) => ({
    id: priority,
    template: "{keyword}",
    language: "*",
    priority,
    enabled: true,
  });

  it("goes after the highest", () => {
    expect(nextPriority([row("1"), row("4"), row("2")])).toBe("5");
    expect(nextPriority([])).toBe("1");
    expect(nextPriority([row(""), row("x")])).toBe("1");
    expect(nextPriority([row("99")])).toBe("99");
  });
});

describe("formWeightsTotal", () => {
  it("totals the five parts live, blanks count as 0", () => {
    const f = configToForm(defaultConfig());
    expect(formWeightsTotal(f)).toBe(100);
    f.w_overlap = "";
    expect(formWeightsTotal(f)).toBe(80);
  });
});
