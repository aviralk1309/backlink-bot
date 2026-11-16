import { describe, expect, it } from "vitest";
import { reviewRows } from "./review-input";

const one = "94000000-0000-0000-0000-000000000011:3";
const two = "94000000-0000-0000-0000-000000000012:4";

function form(intent: string, rows = [one]) {
  const data = new FormData();
  data.set("intent", intent);
  rows.forEach((row) => data.append("row", row));
  return data;
}

describe("review action input", () => {
  it("accepts bounded bulk decisions and trims one shared note", () => {
    const data = form("reject", [one, two]);
    data.set("reason", "off_topic");
    data.set("note", "  Not relevant  ");
    expect(reviewRows(data)).toEqual({
      intent: "reject",
      rows: [
        { id: "94000000-0000-0000-0000-000000000011", version: 3 },
        { id: "94000000-0000-0000-0000-000000000012", version: 4 },
      ],
      reason: "off_topic",
      note: "Not relevant",
    });
  });

  it("rejects duplicate, malformed and unsafe selections", () => {
    expect(reviewRows(form("approve", [one, one]))).toHaveProperty("error");
    expect(reviewRows(form("approve", ["javascript:1"]))).toHaveProperty(
      "error",
    );
    expect(reviewRows(form("claim", [one, two]))).toHaveProperty("error");
    expect(
      reviewRows(form("approve", [one.replace(":3", ":9007199254740992")])),
    ).toHaveProperty("error");
  });

  it("requires an explicit note for Other and rejects inherited reason names", () => {
    const data = form("reject");
    data.set("reason", "other");
    data.set("note", "   ");
    expect(reviewRows(data)).toHaveProperty("error");
    data.set("reason", "constructor");
    expect(reviewRows(data)).toHaveProperty("error");
  });
});
