import { describe, expect, it } from "vitest";
import { parseReportFilters, reportExportHref } from "./filters";

describe("report filters", () => {
  it("accepts a decision period and builds the same export filter", () => {
    const filters = parseReportFilters({
      from: "2026-10-01",
      to: "2026-10-30",
      activity: "guest_post",
    });
    expect(filters).toEqual({
      job: null,
      from: "2026-10-01",
      to: "2026-10-30",
      activity: "guest_post",
    });
    expect(reportExportHref(filters!)).toBe(
      "/api/reports/export?from=2026-10-01&to=2026-10-30&activity=guest_post",
    );
  });

  it("rejects malformed and reversed dates, repeated parameters and invalid activities", () => {
    expect(parseReportFilters({ from: "2026-02-29" })).toBeNull();
    expect(
      parseReportFilters({ from: "2026-10-31", to: "2026-10-01" }),
    ).toBeNull();
    expect(parseReportFilters({ job: ["one", "two"] })).toBeNull();
    expect(parseReportFilters({ activity: "../admin" })).toBeNull();
  });
});
