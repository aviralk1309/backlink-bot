import { describe, expect, it } from "vitest";
import { JOB_WRITE_COLUMNS } from "./schemas";
import {
  FIELD_LABELS,
  actorLabel,
  activityNames,
  buildListHref,
  countryName,
  describeEvent,
  languageName,
  pageRange,
  parseTab,
} from "./view";

describe("buildListHref", () => {
  it("drops empty filters and the first page", () => {
    expect(buildListHref({})).toBe("/jobs");
    expect(buildListHref({ status: null, q: "", page: 1 })).toBe("/jobs");
  });

  it("keeps the filters that are set", () => {
    expect(buildListHref({ status: "running", q: "yoga", page: 3 })).toBe(
      "/jobs?status=running&q=yoga&page=3",
    );
  });

  it("encodes the search text", () => {
    expect(buildListHref({ q: "a&b c" })).toBe("/jobs?q=a%26b+c");
  });
});

describe("pageRange", () => {
  it("handles no results", () => {
    expect(pageRange(1, 0)).toEqual({
      from: 0,
      to: 0,
      hasPrev: false,
      hasNext: false,
    });
  });

  it("covers a single page", () => {
    expect(pageRange(1, 10)).toEqual({
      from: 1,
      to: 10,
      hasPrev: false,
      hasNext: false,
    });
  });

  it("covers a middle page and the last page", () => {
    expect(pageRange(2, 61)).toEqual({
      from: 26,
      to: 50,
      hasPrev: true,
      hasNext: true,
    });
    expect(pageRange(3, 61)).toEqual({
      from: 51,
      to: 61,
      hasPrev: true,
      hasNext: false,
    });
  });

  it("has no next page when the total fills the page exactly", () => {
    expect(pageRange(1, 25).hasNext).toBe(false);
  });
});

describe("parseTab", () => {
  it("accepts the three tabs and falls back to overview", () => {
    expect(parseTab("settings")).toBe("settings");
    expect(parseTab("activity")).toBe("activity");
    expect(parseTab("nope")).toBe("overview");
    expect(parseTab(undefined)).toBe("overview");
  });
});

describe("lookups", () => {
  it("maps activity keys to names and keeps unknown keys", () => {
    expect(
      activityNames(
        ["guest_post", "old_one"],
        [{ key: "guest_post", name: "Guest post", enabled: true }],
      ),
    ).toEqual(["Guest post", "old_one"]);
  });

  it("names countries and languages, falling back to the code", () => {
    expect(countryName("IN")).toBe("India");
    expect(countryName("ZZ")).toBe("ZZ");
    expect(countryName(null)).toBeNull();
    expect(languageName("en")).toBe("English");
    expect(languageName("xx")).toBe("xx");
    expect(languageName(null)).toBeNull();
  });
});

describe("FIELD_LABELS", () => {
  it("has a plain name for every column a user can edit", () => {
    for (const col of JOB_WRITE_COLUMNS) {
      expect(FIELD_LABELS[col], col).toBeTruthy();
    }
  });
});

describe("describeEvent", () => {
  const ev = (
    type: string,
    payload: Record<string, unknown> = {},
    config_version: number | null = 1,
  ) => ({ type, payload, config_version });

  it("describes creation", () => {
    expect(describeEvent(ev("created"))).toBe("Created the job.");
  });

  it("lists edited fields in plain words", () => {
    expect(
      describeEvent(ev("edited", { fields: ["name", "seed_keywords"] })),
    ).toBe("Edited job name, seed keywords.");
  });

  it("shortens a long field list", () => {
    const fields = [
      "name",
      "client",
      "client_domain",
      "country",
      "language",
      "regions",
      "seed_keywords",
    ];
    expect(describeEvent(ev("edited", { fields }))).toBe(
      "Edited job name, client, client domain, country, language and 2 more.",
    );
  });

  it("falls back for a column it does not know", () => {
    expect(describeEvent(ev("edited", { fields: ["new_column"] }))).toBe(
      "Edited new column.",
    );
  });

  it("mentions the new settings version", () => {
    expect(
      describeEvent(ev("config_changed", { fields: ["seed_keywords"] }, 2)),
    ).toBe("Changed seed keywords. Settings are now version 2.");
  });

  it.each([
    ["start", {}, "Started the job. It is queued for a worker."],
    ["pick_up", {}, "Picked up the job."],
    ["pause", {}, "Paused the job."],
    ["resume", {}, "Resumed the job."],
    ["stop", {}, "Stopped the job."],
    ["stop", { reason: "client paused" }, "Stopped the job: client paused"],
    ["complete", {}, "Finished every query. The job is completed."],
    ["fail", { reason: "bad config" }, "The job failed: bad config"],
  ])("describes a %s transition", (action, extra, text) => {
    expect(describeEvent(ev("status_changed", { action, ...extra }))).toBe(
      text,
    );
  });

  it("describes an automatic pause", () => {
    expect(
      describeEvent(ev("status_changed", { action: "saturate" })),
    ).toContain("too few new domains");
  });

  it("falls back to the status names for an unknown action", () => {
    expect(
      describeEvent(
        ev("status_changed", {
          action: "new_thing",
          from: "running",
          to: "paused",
        }),
      ),
    ).toBe("Changed status from Running to Paused.");
  });

  it("reads sensibly for an event type it has never seen", () => {
    expect(describeEvent(ev("results_released"))).toBe("Results released.");
  });
});

describe("actorLabel", () => {
  it("prefers the person's name", () => {
    expect(actorLabel({ actor_id: "x", actor_name: "Aviral" })).toBe("Aviral");
  });

  it("uses a neutral label when the name is hidden by RLS", () => {
    expect(actorLabel({ actor_id: "x", actor_name: null })).toBe(
      "A team member",
    );
  });

  it("calls worker events System", () => {
    expect(actorLabel({ actor_id: null, actor_name: null })).toBe("System");
  });
});
