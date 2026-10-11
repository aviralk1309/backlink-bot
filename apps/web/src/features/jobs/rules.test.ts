import { describe, expect, it } from "vitest";
import {
  availableActions,
  cleanDomainList,
  cleanTextList,
  cleanUrlList,
  describeStartProblems,
  isDeletable,
  isEditable,
  legalActions,
  normalizeDomain,
  normalizeUrl,
  parseListParams,
  parseStartProblems,
  planJobSave,
  planTransition,
  sanitizeSearch,
} from "./rules";
import { JOB_STATUSES, type ActivityOption } from "./types";

describe("normalizeDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["  Example.COM  ", "example.com"],
    ["https://www.example.com/path?x=1#top", "example.com"],
    ["http://example.com:8080/", "example.com"],
    ["www.example.co.uk", "example.co.uk"],
    ["blog.example.com", "blog.example.com"],
    ["example.com.", "example.com"],
    ["münchen.de", "xn--mnchen-3ya.de"],
    ["www.com", "www.com"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "localhost",
    "192.168.0.1",
    "example",
    "exa mple.com",
    "exa_mple.com",
    "ftp://example.com",
    "user:pass@example.com",
    "https://",
    "-bad-.com",
    "example.c",
  ])("rejects %j", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["HTTP://Example.com/", "http://example.com"],
    ["https://example.com/a/b?x=1#frag", "https://example.com/a/b?x=1"],
    ["https://example.com/?x=1", "https://example.com/?x=1"],
    ["https://www.example.com/page", "https://www.example.com/page"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "http://localhost:3000/x",
    "http://127.0.0.1/",
    "https://exa mple.com",
    "ftp://example.com/file",
  ])("rejects %j", (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });

  it("rejects a very long address", () => {
    expect(normalizeUrl(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("cleanTextList", () => {
  const o = { label: "Seed keywords", max: 3, maxLen: 15 };

  it("collapses spaces, drops blanks and removes duplicates", () => {
    expect(
      cleanTextList(["  yoga   retreat ", "", "Yoga Retreat", "bali"], o),
    ).toEqual({ ok: true, values: ["yoga retreat", "bali"] });
  });

  it("keeps case unless asked to lowercase", () => {
    expect(cleanTextList(["Acme Co", "acme co"], o)).toEqual({
      ok: true,
      values: ["Acme Co"],
    });
    expect(cleanTextList(["Acme Co"], { ...o, lower: true })).toEqual({
      ok: true,
      values: ["acme co"],
    });
  });

  it("reports an entry that is too long", () => {
    const r = cleanTextList(["this is far too long"], o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Seed keywords");
  });

  it("reports too many entries", () => {
    const r = cleanTextList(["a", "b", "c", "d"], o);
    expect(r).toEqual({
      ok: false,
      error: "Seed keywords: too many entries (3 at most).",
    });
  });
});

describe("cleanDomainList and cleanUrlList", () => {
  it("normalizes and de-duplicates domains", () => {
    expect(
      cleanDomainList(["https://www.A.com/x", "a.com", "b.org", " "], {
        label: "Competitors",
        max: 10,
      }),
    ).toEqual({ ok: true, values: ["a.com", "b.org"] });
  });

  it("names the label and the bad value", () => {
    const r = cleanDomainList(["a.com", "not a domain"], {
      label: "Competitors",
      max: 10,
    });
    expect(r).toEqual({
      ok: false,
      error: "Competitors: “not a domain” is not a valid domain.",
    });
  });

  it("normalizes and de-duplicates URLs", () => {
    expect(
      cleanUrlList(["example.com", "https://example.com/"], {
        label: "Seed list URLs",
        max: 10,
      }),
    ).toEqual({ ok: true, values: ["https://example.com"] });
  });

  it("names the label and the bad URL", () => {
    const r = cleanUrlList(["http://localhost/x"], {
      label: "Seed list URLs",
      max: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Seed list URLs");
  });
});

describe("lifecycle rules", () => {
  it("allows exactly the transitions the database allows", () => {
    expect(JOB_STATUSES.map((s) => [s, [...legalActions(s)]])).toEqual([
      ["draft", ["start"]],
      ["queued", ["stop"]],
      ["running", ["pause", "stop"]],
      ["paused", ["resume", "stop"]],
      ["completed", []],
      ["failed", []],
      ["saturated", ["resume", "stop"]],
      ["stopped", []],
    ]);
  });

  it("offers only actions the user may take", () => {
    expect(availableActions("running", ["jobs.control"])).toEqual([
      "pause",
      "stop",
    ]);
    expect(availableActions("draft", ["jobs.control"])).toEqual([]);
    expect(availableActions("draft", ["jobs.start"])).toEqual(["start"]);
    expect(availableActions("running", ["jobs.view"])).toEqual([]);
    expect(availableActions("stopped", ["jobs.start", "jobs.control"])).toEqual(
      [],
    );
  });

  it("makes finished jobs read-only", () => {
    for (const s of ["completed", "failed", "stopped"] as const) {
      expect(isEditable(s)).toBe(false);
    }
    for (const s of [
      "draft",
      "queued",
      "running",
      "paused",
      "saturated",
    ] as const) {
      expect(isEditable(s)).toBe(true);
    }
  });

  it("blocks deleting queued and running jobs only", () => {
    expect(isDeletable("queued")).toBe(false);
    expect(isDeletable("running")).toBe(false);
    expect(isDeletable("draft")).toBe(true);
    expect(isDeletable("paused")).toBe(true);
    expect(isDeletable("stopped")).toBe(true);
  });
});

describe("planTransition", () => {
  it("accepts a legal action", () => {
    expect(
      planTransition({ status: "draft", action: "start", confirm: false }),
    ).toEqual({ ok: true });
  });

  it("refuses an illegal action with a plain message", () => {
    const r = planTransition({
      status: "stopped",
      action: "resume",
      confirm: false,
    });
    expect(r).toEqual({
      ok: false,
      error: "That action is not available while the job is stopped.",
    });
  });

  it("needs confirmation to resume a saturated job (G3)", () => {
    expect(
      planTransition({ status: "saturated", action: "resume", confirm: false }),
    ).toMatchObject({ ok: false });
    expect(
      planTransition({ status: "saturated", action: "resume", confirm: true }),
    ).toEqual({ ok: true });
  });

  it("does not ask for confirmation when resuming a paused job", () => {
    expect(
      planTransition({ status: "paused", action: "resume", confirm: false }),
    ).toEqual({ ok: true });
  });
});

describe("start problems", () => {
  it("extracts codes from a database error", () => {
    expect(
      parseStartProblems(
        "P0001: job_not_ready:missing_country,no_source (CONTEXT: PL/pgSQL)",
      ),
    ).toEqual(["missing_country", "no_source"]);
  });

  it("returns nothing for other errors", () => {
    expect(
      parseStartProblems("invalid_transition: start from running"),
    ).toEqual([]);
  });

  it("turns codes into one readable message", () => {
    const text = describeStartProblems(["missing_country", "no_activity"]);
    expect(text).toContain("cannot start yet");
    expect(text).toContain("Choose a country.");
    expect(text).toContain("Choose at least one activity.");
  });

  it("shows an unknown code as is", () => {
    expect(describeStartProblems(["something_new"])).toContain("something_new");
  });
});

describe("planJobSave", () => {
  const activities: ActivityOption[] = [
    { key: "guest_post", name: "Guest post", enabled: true },
    { key: "forum", name: "Forum", enabled: false },
  ];

  it("accepts enabled activities", () => {
    expect(
      planJobSave({
        previousActivityKeys: null,
        activityKeys: ["guest_post"],
        activities,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses an unknown activity", () => {
    expect(
      planJobSave({
        previousActivityKeys: null,
        activityKeys: ["nope"],
        activities,
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses newly selecting a disabled activity", () => {
    const r = planJobSave({
      previousActivityKeys: ["guest_post"],
      activityKeys: ["guest_post", "forum"],
      activities,
    });
    expect(r).toEqual({
      ok: false,
      error: "The “Forum” activity is disabled. Ask an admin to enable it.",
    });
  });

  it("lets a job keep an activity that was disabled later", () => {
    expect(
      planJobSave({
        previousActivityKeys: ["forum"],
        activityKeys: ["forum"],
        activities,
      }),
    ).toEqual({ ok: true });
  });
});

describe("list filters", () => {
  it("removes characters that could change a filter", () => {
    expect(sanitizeSearch("  a%b_c*d,e(f)g\"h'i\\j  ")).toBe(
      "a b c d e f g h i j",
    );
  });

  it("limits search length", () => {
    expect(sanitizeSearch("x".repeat(300))).toHaveLength(100);
  });

  it("parses valid parameters", () => {
    expect(
      parseListParams({ status: "running", q: " yoga ", page: "3" }),
    ).toEqual({ status: "running", q: "yoga", page: 3 });
  });

  it("falls back for bad parameters", () => {
    expect(
      parseListParams({ status: "nope", q: undefined, page: "-2" }),
    ).toEqual({ status: null, q: "", page: 1 });
    expect(parseListParams({ page: "abc" }).page).toBe(1);
    expect(parseListParams({ page: "99999999" }).page).toBe(10_000);
    expect(parseListParams({})).toEqual({ status: null, q: "", page: 1 });
  });
});
