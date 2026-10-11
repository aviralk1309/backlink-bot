import { describe, expect, it } from "vitest";
import { TRANSITION_NOTICE, savedNotice } from "./notice";

describe("savedNotice", () => {
  it.each([
    ["created", "Job created."],
    ["updated", "Job saved."],
    ["deleted", "Job deleted."],
  ])("maps %s", (flag, text) => {
    expect(savedNotice(flag)).toBe(text);
  });

  it("ignores unknown or missing flags", () => {
    expect(savedNotice(undefined)).toBeNull();
    expect(savedNotice("")).toBeNull();
    expect(savedNotice("toString")).toBeNull();
  });
});

describe("TRANSITION_NOTICE", () => {
  it("has a message for every user action", () => {
    expect(Object.keys(TRANSITION_NOTICE).sort()).toEqual([
      "pause",
      "resume",
      "start",
      "stop",
    ]);
  });
});
