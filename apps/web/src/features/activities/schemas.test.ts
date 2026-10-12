import { describe, expect, it } from "vitest";
import { configToForm, serializeConfig, type FormConfig } from "./form-values";
import { defaultConfig } from "./rules";
import { activityFormInput, configSchema, saveActivitySchema } from "./schemas";
import type { ActivityConfig } from "./types";

/** The guest_post profile seeded by the migration. */
const GUEST_POST: ActivityConfig = {
  per_domain_cap: 3,
  footprint_templates: [
    {
      id: "gp_guest_post",
      template: '{keyword} "guest post"',
      language: "*",
      priority: 2,
      enabled: true,
    },
    {
      id: "gp_write_for_us",
      template: '"write for us" {keyword}',
      language: "*",
      priority: 1,
      enabled: true,
    },
  ],
  page_type_signals: {
    url_patterns: ["write-for-us", "guest-post"],
    title_phrases: ["write for us"],
    heading_phrases: ["guest post guidelines"],
    body_phrases: ["submission guidelines"],
    structure: { link_list: false, min_outbound_links: 0 },
  },
  relevance_rule: {
    field_weights: { title: 3, headings: 2, meta: 2, body: 1 },
    min_score: 0.2,
  },
  scoring_weights: {
    relevance: 35,
    language_region: 10,
    activity_fit: 20,
    overlap: 20,
    multi_query: 15,
    spam_penalty: 30,
  },
  reviewer_fields: [
    { key: "dr", label: "Domain rating", type: "number" },
    { key: "guidelines_url", label: "Guidelines page", type: "url" },
  ],
};

const ID = "11111111-1111-4111-8111-111111111111";

function formData(over: Record<string, string> = {}, config?: FormConfig) {
  const fd = new FormData();
  const base: Record<string, string> = {
    activity_id: ID,
    name: "Guest post",
    enabled: "on",
    seen_updated_at: "2026-10-11T10:00:00.000Z",
    config: serializeConfig(config ?? configToForm(GUEST_POST)),
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

const parse = (fd: FormData) =>
  saveActivitySchema.safeParse(activityFormInput(fd));

describe("round trip through the form", () => {
  it("saves a seeded profile unchanged, with templates in run order", () => {
    const r = configSchema.parse(
      JSON.parse(serializeConfig(configToForm(GUEST_POST))),
    );
    expect(r).toEqual({
      ...GUEST_POST,
      footprint_templates: [...GUEST_POST.footprint_templates].reverse(),
    });
  });

  it("accepts the defaults for a new activity", () => {
    const r = parse(
      formData(
        { activity_id: "", key: "directory_listing", seen_updated_at: "" },
        configToForm(defaultConfig()),
      ),
    );
    expect(r.success).toBe(true);
  });

  it("produces exactly the columns the database lets clients write", () => {
    const r = parse(formData());
    if (!r.success) throw new Error(r.error.message);
    expect(Object.keys(r.data.config).sort()).toEqual([
      "footprint_templates",
      "page_type_signals",
      "per_domain_cap",
      "relevance_rule",
      "reviewer_fields",
      "scoring_weights",
    ]);
  });
});

describe("saveActivitySchema", () => {
  const error = (fd: FormData) => {
    const r = parse(fd);
    if (r.success) throw new Error("expected a failure");
    return r.error.issues[0]?.message ?? "";
  };

  it("needs a name", () => {
    expect(error(formData({ name: "  " }))).toContain("Enter a name");
  });

  it("needs a valid key when creating, and ignores it when editing", () => {
    expect(
      error(formData({ activity_id: "", key: "Bad Key", seen_updated_at: "" })),
    ).toContain("The key must be");
    expect(parse(formData({ key: "Bad Key" })).success).toBe(true);
  });

  it("lowercases the key", () => {
    const r = parse(formData({ activity_id: "", key: " Guest_Post2 " }));
    expect(r.success && r.data.key).toBe("guest_post2");
  });

  it("needs the version it was editing", () => {
    expect(error(formData({ seen_updated_at: "" }))).toContain("Reload");
  });

  it("reads the checkbox", () => {
    const on = parse(formData());
    const off = parse(formData({ enabled: "" }));
    expect(on.success && on.data.enabled).toBe(true);
    expect(off.success && off.data.enabled).toBe(false);
  });

  it("will not enable an activity with no enabled template", () => {
    const form = configToForm(GUEST_POST);
    form.templates = form.templates.map((t) => ({ ...t, enabled: false }));
    expect(error(formData({}, form))).toContain(
      "at least one enabled search template",
    );
    // switched off, it is fine
    expect(parse(formData({ enabled: "" }, form)).success).toBe(true);
  });

  it("rejects text that is not JSON without throwing", () => {
    expect(error(formData({ config: "{nope" }))).toContain("could not be read");
  });

  it("does not crash when the config is broken and the name is fine", () => {
    expect(
      error(formData({ config: JSON.stringify({ per_domain_cap: 3 }) })),
    ).toBeTruthy();
  });
});

describe("configSchema messages", () => {
  const message = (change: (f: FormConfig) => void) => {
    const form = configToForm(GUEST_POST);
    change(form);
    const r = configSchema.safeParse(JSON.parse(serializeConfig(form)));
    if (r.success) throw new Error("expected a failure");
    return r.error.issues[0]?.message ?? "";
  };

  it("names a blank number", () => {
    expect(message((f) => (f.per_domain_cap = ""))).toBe(
      "Per-domain cap must be a number.",
    );
  });

  it("checks ranges", () => {
    expect(message((f) => (f.per_domain_cap = "0"))).toContain("at least 1");
    expect(message((f) => (f.per_domain_cap = "1001"))).toContain(
      "at most 1000",
    );
    expect(message((f) => (f.per_domain_cap = "2.5"))).toContain(
      "whole number",
    );
    expect(message((f) => (f.min_score = "1.5"))).toContain("between 0 and 1");
  });

  it("wants the weights to add up to 100", () => {
    expect(message((f) => (f.w_relevance = "40"))).toContain(
      "add up to 100 (they add up to 105)",
    );
  });

  it("wants some relevance field weight", () => {
    expect(
      message((f) => {
        f.fw_title = f.fw_headings = f.fw_meta = f.fw_body = "0";
      }),
    ).toContain("above 0");
  });

  it("reports a bad template by its text", () => {
    expect(message((f) => (f.templates[0]!.template = "{oops}"))).toContain(
      "{oops}",
    );
  });

  it("rejects an unknown language and accepts a known one", () => {
    expect(message((f) => (f.templates[0]!.language = "zz"))).toContain(
      "language",
    );
    const form = configToForm(GUEST_POST);
    form.templates[0]!.language = "de";
    expect(
      configSchema.safeParse(JSON.parse(serializeConfig(form))).success,
    ).toBe(true);
  });

  it("rejects repeated template ids and reviewer keys", () => {
    expect(message((f) => (f.templates[1]!.id = f.templates[0]!.id))).toContain(
      "ids repeat",
    );
    expect(message((f) => (f.reviewer_fields[1]!.key = "dr"))).toContain(
      "used twice",
    );
  });

  it("cleans phrase lists", () => {
    const form = configToForm(GUEST_POST);
    form.title_phrases = ["  Write  For Us ", "write for us", ""];
    const r = configSchema.parse(JSON.parse(serializeConfig(form)));
    expect(r.page_type_signals.title_phrases).toEqual(["write for us"]);
  });

  it("limits phrase lists", () => {
    const many = Array.from({ length: 31 }, (_, i) => `p${i}`);
    expect(message((f) => (f.body_phrases = many))).toContain("too many");
  });
});
