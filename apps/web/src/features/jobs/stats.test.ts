import { describe, expect, it } from "vitest";
import { creditPercent, formatCount, isPollingStatus } from "./stats";

describe("formatCount", () => {
  it("groups thousands with en-US", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(0)).toBe("0");
  });
  it("never prints NaN or Infinity", () => {
    expect(formatCount(Number.NaN)).toBe("0");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("creditPercent", () => {
  it("rounds to a whole percent", () => {
    expect(creditPercent(1, 3)).toBe(33);
    expect(creditPercent(50, 100)).toBe(50);
  });
  it("is 0 without a budget", () => {
    expect(creditPercent(10, 0)).toBe(0);
    expect(creditPercent(10, -5)).toBe(0);
  });
  it("clamps overshoot and negatives", () => {
    expect(creditPercent(150, 100)).toBe(100);
    expect(creditPercent(-1, 100)).toBe(0);
  });
});

describe("isPollingStatus", () => {
  it("polls while counters can change", () => {
    for (const s of ["queued", "running", "paused", "saturated"] as const) {
      expect(isPollingStatus(s)).toBe(true);
    }
  });
  it("does not poll draft or terminal jobs", () => {
    for (const s of ["draft", "completed", "failed", "stopped"] as const) {
      expect(isPollingStatus(s)).toBe(false);
    }
  });
});
