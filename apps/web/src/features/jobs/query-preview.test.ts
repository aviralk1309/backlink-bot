import { describe, expect, it } from "vitest";
import { emptyJobFormValues } from "./form-values";
import { previewQueries } from "./query-preview";
import type { ActivityPlanProfile } from "./types";

const profiles: ActivityPlanProfile[] = [
  {
    key: "guest_post",
    name: "Guest posts",
    enabled: true,
    footprint_templates: [
      {
        id: "gp",
        template: "{keyword} {city} guest post",
        language: "*",
        priority: 1,
        enabled: true,
      },
    ],
  },
  {
    key: "resource_page",
    name: "Resource pages",
    enabled: true,
    footprint_templates: [
      {
        id: "rp",
        template: "{keyword} {city} resources",
        language: "en",
        priority: 1,
        enabled: true,
      },
    ],
  },
];

describe("query preview", () => {
  const job = {
    ...emptyJobFormValues(),
    activityKeys: ["guest_post", "resource_page"],
    country: "US",
    language: "en",
    seedKeywords: ["Yoga", "Travel"],
    regions: ["Boston", "Austin"],
    budgetCredits: "4",
    pagesPerQuery: "3",
  };

  it("shows the same first-page order and omitted region as the worker", () => {
    const preview = previewQueries(job, profiles)!;
    expect(preview.rows.map((row) => row.query)).toEqual([
      "Yoga Boston guest post",
      "Yoga Austin resources",
      "Travel Austin guest post",
      "Travel Boston resources",
    ]);
    expect(preview.omittedKeywords).toEqual([]);
    expect(preview.omittedActivities).toEqual([]);
    expect(preview.omittedLocations).toEqual([]);
    expect(preview.maxPage).toBe(3);
  });

  it("deduplicates requests and keeps the credit budget", () => {
    const one = profiles[0]!;
    const template = {
      ...one.footprint_templates[0]!,
      template: "{keyword} guest post",
    };
    const duplicate = {
      ...one,
      footprint_templates: [template, { ...template, id: "copy" }],
    };
    const preview = previewQueries(
      { ...job, activityKeys: ["guest_post"], regions: [], budgetCredits: "1" },
      [duplicate],
    )!;
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.query).toBe("Yoga guest post");
  });

  it("returns no paid requests with a zero budget", () => {
    expect(
      previewQueries({ ...job, budgetCredits: "0" }, profiles)?.rows,
    ).toEqual([]);
  });
});
