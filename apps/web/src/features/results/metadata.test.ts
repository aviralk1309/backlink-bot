import { describe, expect, it } from "vitest";
import { metricPatch } from "./metadata";

const fields = [
  { key: "dr", label: "Domain rating", type: "number" as const },
  { key: "guidelines_url", label: "Guidelines", type: "url" as const },
  { key: "contact_email", label: "Contact", type: "text" as const },
];

describe("external metric input", () => {
  it("normalizes fields and clears blanks", () => {
    const form = new FormData();
    form.set("metric:dr", " 42.5 ");
    form.set("metric:guidelines_url", " ");
    form.set("metric:contact_email", " name@example.com ");
    expect(metricPatch(form, fields)).toEqual({
      values: {
        dr: 42.5,
        guidelines_url: null,
        contact_email: "name@example.com",
      },
    });
  });

  it("rejects invalid numbers and executable URL schemes", () => {
    const form = new FormData();
    form.set("metric:dr", "1e999");
    form.set("metric:guidelines_url", "javascript:alert(1)");
    form.set("metric:contact_email", "ok");
    expect(metricPatch(form, fields)).toHaveProperty("error");
    form.set("metric:dr", "80");
    expect(metricPatch(form, fields)).toHaveProperty("error");
    form.set("metric:guidelines_url", "https://example.com/guidelines");
    form.set("metric:dr", "101");
    expect(metricPatch(form, fields)).toHaveProperty("error");
  });
});
