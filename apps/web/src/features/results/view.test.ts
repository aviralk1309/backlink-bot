import { describe, expect, it } from "vitest";
import {
  detailId,
  parseResultsParams,
  resultsHref,
  searchPattern,
  topReasons,
} from "./view";

describe("results URL state", () => {
  it("opens Ready by default and rejects invalid filter and cursor values", () => {
    expect(parseResultsParams({})).toMatchObject({
      queue: "ready",
      group: false,
      sort: "score",
      cursor: null,
    });
    expect(
      parseResultsParams({ queue: "bad", tier: "bad", cursor: "not-a-uuid" }),
    ).toMatchObject({ queue: "ready", tier: null, cursor: null });
  });

  it("keeps filters in links and resets the cursor when a tab changes", () => {
    const p = parseResultsParams({ queue: "backlog", q: "a&b", tier: "high" });
    expect(resultsHref("job-id", p, { queue: "all", cursor: null })).toBe(
      "/jobs/job-id?tab=results&queue=all&tier=high&q=a%26b",
    );
  });

  it("accepts site crawl as a result source", () => {
    expect(parseResultsParams({ source: "site_crawl" }).source).toBe(
      "site_crawl",
    );
  });

  it("accepts domain cursors only in grouped mode", () => {
    expect(
      parseResultsParams({ group: "domain", cursor: "alpha.com" }).cursor,
    ).toBe("alpha.com");
    expect(parseResultsParams({ cursor: "alpha.com" }).cursor).toBeNull();
  });

  it("escapes SQL LIKE wildcards for literal search", () => {
    expect(searchPattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("links to a selected result without carrying it into other views", () => {
    const id = "97000000-0000-0000-0000-000000000004";
    const p = parseResultsParams({ queue: "all" });
    expect(detailId({ detail: id })).toBe(id);
    expect(detailId({ detail: "javascript:alert(1)" })).toBeNull();
    expect(resultsHref("job-id", p, { detail: id })).toContain(`&detail=${id}`);
    expect(resultsHref("job-id", p)).toBe("/jobs/job-id?tab=results&queue=all");
  });
});

describe("score reasons", () => {
  it("shows at most three safe text reasons", () => {
    expect(
      topReasons({
        top_reasons: [
          { text: "Relevant" },
          { text: "Overlap" },
          { text: "Contact" },
          { text: "Fourth" },
        ],
      }),
    ).toEqual(["Relevant", "Overlap", "Contact"]);
    expect(topReasons({ top_reasons: [null, 3, { text: false }] })).toEqual([]);
  });
});
