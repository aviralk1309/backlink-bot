/**
 * Phase 4 QA: Activity Profiles — Form Validation & Boundary Value Analysis
 *
 * Covers template placeholder rules, scoring weight sum constraints,
 * page-type signal phrase limits, reviewer field limits, and config
 * edge cases not covered in the existing schemas.test.ts.
 */
import { describe, expect, it } from "vitest";
import { configToForm, serializeConfig } from "./form-values";
import { TEMPLATE_MAX_LENGTH, defaultConfig, weightsTotal } from "./rules";
import { configSchema, saveActivitySchema, activityFormInput } from "./schemas";
import type { ActivityConfig } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid activity config (the default). */
function baseConfig(): ActivityConfig {
  return defaultConfig();
}

/** Parse a mutated FormConfig through configSchema. */
function parseConfig(mutate: (raw: Record<string, unknown>) => void) {
  const raw = JSON.parse(serializeConfig(configToForm(baseConfig()))) as Record<
    string,
    unknown
  >;
  mutate(raw);
  return configSchema.safeParse(raw);
}

function msgConfig(mutate: (raw: Record<string, unknown>) => void): string {
  const r = parseConfig(mutate);
  if (r.success) throw new Error("Expected failure");
  return r.error.issues[0]?.message ?? "";
}

/** Build a minimal FormData for saveActivitySchema (edit flow). */
function buildFd(over: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    activity_id: "11111111-1111-4111-8111-111111111111",
    name: "Guest post",
    enabled: "on",
    seen_updated_at: "2026-01-01T00:00:00Z",
    config: serializeConfig(configToForm(baseConfig())),
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

const parseSave = (fd: FormData) =>
  saveActivitySchema.safeParse(activityFormInput(fd));

// ---------------------------------------------------------------------------
// 1. Footprint template — placeholder validation
// ---------------------------------------------------------------------------

describe("footprint template placeholder validation", () => {
  const KNOWN_PLACEHOLDERS = [
    "{keyword}",
    "{niche}",
    "{brand}",
    "{country}",
    "{city}",
  ];

  it.each(KNOWN_PLACEHOLDERS)("accepts valid placeholder %s", (ph) => {
    const r = parseConfig((raw) => {
      (raw.footprint_templates as unknown[])[0] = {
        id: "t1",
        template: `${ph} guest post`,
        language: "*",
        priority: 1,
        enabled: true,
      };
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown placeholder {keywrd}", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "{keywrd} guest post",
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("{keywrd}");
  });

  it("rejects an empty placeholder {}", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "{} guest post",
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("{}");
  });

  it("rejects a stray opening brace (unclosed)", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "{keyword oops",
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("curly brace");
  });

  it("rejects a stray closing brace", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "keyword} {keyword}",
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("curly brace");
  });

  it("rejects a template with no placeholder at all", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: '"write for us" site review',
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("at least one placeholder");
  });

  it("rejects an empty template", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "   ",
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("Enter the search text");
  });

  it(`rejects a template longer than ${TEMPLATE_MAX_LENGTH} characters`, () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: `{keyword} ${"a".repeat(TEMPLATE_MAX_LENGTH)}`,
          language: "*",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("too long");
  });

  it("rejects an unknown language code on a template", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "{keyword}",
          language: "zz",
          priority: 1,
          enabled: true,
        };
      }),
    ).toContain("language");
  });

  it("accepts the wildcard language '*'", () => {
    expect(
      parseConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "{keyword}",
          language: "*",
          priority: 1,
          enabled: true,
        };
      }).success,
    ).toBe(true);
  });

  it("accepts a known language code on a template", () => {
    expect(
      parseConfig((raw) => {
        (raw.footprint_templates as unknown[])[0] = {
          id: "t1",
          template: "{keyword}",
          language: "de",
          priority: 1,
          enabled: true,
        };
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate template ids", () => {
    expect(
      msgConfig((raw) => {
        (raw.footprint_templates as unknown[]).push({
          id: (raw.footprint_templates as Array<{ id: string }>)[0]!.id,
          template: "{keyword} guest post",
          language: "*",
          priority: 2,
          enabled: true,
        });
      }),
    ).toContain("ids repeat");
  });

  it("rejects more than 50 templates", () => {
    const r = parseConfig((raw) => {
      raw.footprint_templates = Array.from({ length: 51 }, (_, i) => ({
        id: `t${i}`,
        template: "{keyword}",
        language: "*",
        priority: i + 1,
        enabled: true,
      }));
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("50");
  });
});

// ---------------------------------------------------------------------------
// 2. Scoring weights — must sum to 100
// ---------------------------------------------------------------------------

describe("scoring weights sum to 100", () => {
  it("default weights sum to exactly 100", () => {
    expect(weightsTotal(defaultConfig().scoring_weights)).toBe(100);
  });

  it("rejects weights that sum to 99", () => {
    expect(
      msgConfig((raw) => {
        (raw.scoring_weights as Record<string, number>).relevance = 34;
      }),
    ).toContain("add up to 100 (they add up to 99)");
  });

  it("rejects weights that sum to 101", () => {
    expect(
      msgConfig((raw) => {
        (raw.scoring_weights as Record<string, number>).relevance = 36;
      }),
    ).toContain("add up to 100 (they add up to 101)");
  });

  it("rejects weights that sum to 0", () => {
    expect(
      msgConfig((raw) => {
        const w = raw.scoring_weights as Record<string, number>;
        w.relevance = 0;
        w.language_region = 0;
        w.activity_fit = 0;
        w.overlap = 0;
        w.multi_query = 0;
      }),
    ).toContain("add up to 100");
  });

  it("accepts any weight combination that sums to 100", () => {
    // All weight on one dimension
    expect(
      parseConfig((raw) => {
        const w = raw.scoring_weights as Record<string, number>;
        w.relevance = 100;
        w.language_region = 0;
        w.activity_fit = 0;
        w.overlap = 0;
        w.multi_query = 0;
      }).success,
    ).toBe(true);
  });

  it("rejects individual weight above 100", () => {
    expect(
      msgConfig((raw) => {
        (raw.scoring_weights as Record<string, number>).relevance = 101;
      }),
    ).toContain("at most 100");
  });

  it("rejects individual weight below 0", () => {
    expect(
      msgConfig((raw) => {
        (raw.scoring_weights as Record<string, number>).relevance = -1;
      }),
    ).toContain("at least 0");
  });
});

// ---------------------------------------------------------------------------
// 3. Relevance rule — field weights must not all be zero
// ---------------------------------------------------------------------------

describe("relevance field weights", () => {
  it("rejects when all four field weights are zero", () => {
    expect(
      msgConfig((raw) => {
        const fw = (
          raw.relevance_rule as Record<string, Record<string, number>>
        ).field_weights;
        fw.title = fw.headings = fw.meta = fw.body = 0;
      }),
    ).toContain("above 0");
  });

  it("accepts when only one field weight is non-zero", () => {
    expect(
      parseConfig((raw) => {
        const fw = (
          raw.relevance_rule as Record<string, Record<string, number>>
        ).field_weights;
        fw.title = 1;
        fw.headings = fw.meta = fw.body = 0;
      }).success,
    ).toBe(true);
  });

  it("rejects min_score > 1", () => {
    expect(
      msgConfig((raw) => {
        (raw.relevance_rule as Record<string, number>).min_score = 1.5;
      }),
    ).toContain("between 0 and 1");
  });

  it("rejects min_score < 0", () => {
    expect(
      msgConfig((raw) => {
        (raw.relevance_rule as Record<string, number>).min_score = -0.1;
      }),
    ).toContain("between 0 and 1");
  });

  it("accepts min_score of exactly 0 and 1", () => {
    for (const score of [0, 1]) {
      expect(
        parseConfig((raw) => {
          (raw.relevance_rule as Record<string, number>).min_score = score;
        }).success,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Page type signals — phrase list limits
// ---------------------------------------------------------------------------

describe("page_type_signals phrase list limits", () => {
  const PHRASE_LISTS = [
    "url_patterns",
    "title_phrases",
    "heading_phrases",
    "body_phrases",
  ] as const;

  it.each(PHRASE_LISTS)("%s: rejects more than 30 items", (listKey) => {
    expect(
      msgConfig((raw) => {
        const pts = raw.page_type_signals as Record<string, unknown[]>;
        pts[listKey] = Array.from({ length: 31 }, (_, i) => `item${i}`);
      }),
    ).toContain("too many");
  });

  it.each(PHRASE_LISTS)("%s: accepts exactly 30 items", (listKey) => {
    expect(
      parseConfig((raw) => {
        const pts = raw.page_type_signals as Record<string, unknown[]>;
        pts[listKey] = Array.from({ length: 30 }, (_, i) => `item${i}`);
      }).success,
    ).toBe(true);
  });

  it.each(PHRASE_LISTS)(
    "%s: rejects an item exceeding 100 characters",
    (listKey) => {
      expect(
        msgConfig((raw) => {
          const pts = raw.page_type_signals as Record<string, unknown[]>;
          pts[listKey] = ["a".repeat(101)];
        }),
      ).toContain("too long");
    },
  );

  it("lowercases all phrase items", () => {
    const r = parseConfig((raw) => {
      const pts = raw.page_type_signals as Record<string, unknown[]>;
      pts.title_phrases = ["Write For Us", "GUEST POST"];
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page_type_signals.title_phrases).toEqual([
        "write for us",
        "guest post",
      ]);
    }
  });

  it("deduplicates phrase items case-insensitively", () => {
    const r = parseConfig((raw) => {
      const pts = raw.page_type_signals as Record<string, unknown[]>;
      pts.title_phrases = ["write for us", "Write For Us", "WRITE FOR US"];
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page_type_signals.title_phrases).toEqual(["write for us"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. per_domain_cap in config (activity-level, distinct from job-level)
// ---------------------------------------------------------------------------

describe("activity config per_domain_cap", () => {
  it("accepts 1 (minimum)", () => {
    expect(
      parseConfig((raw) => {
        (raw as Record<string, number>).per_domain_cap = 1;
      }).success,
    ).toBe(true);
  });

  it("accepts 1000 (maximum)", () => {
    expect(
      parseConfig((raw) => {
        (raw as Record<string, number>).per_domain_cap = 1000;
      }).success,
    ).toBe(true);
  });

  it("rejects 0 (below minimum)", () => {
    expect(
      msgConfig((raw) => {
        (raw as Record<string, number>).per_domain_cap = 0;
      }),
    ).toContain("at least 1");
  });

  it("rejects 1001 (above maximum)", () => {
    expect(
      msgConfig((raw) => {
        (raw as Record<string, number>).per_domain_cap = 1001;
      }),
    ).toContain("at most 1000");
  });

  it("rejects a non-integer", () => {
    expect(
      msgConfig((raw) => {
        (raw as Record<string, number>).per_domain_cap = 2.5;
      }),
    ).toContain("whole number");
  });
});

// ---------------------------------------------------------------------------
// 6. saveActivitySchema — top-level fields
// ---------------------------------------------------------------------------

describe("saveActivitySchema top-level field boundaries", () => {
  it("rejects an empty name", () => {
    const fd = buildFd({ name: "  " });
    const r = parseSave(fd);
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toContain("Enter a name");
  });

  it("rejects a name > 80 characters", () => {
    const fd = buildFd({ name: "a".repeat(81) });
    const r = parseSave(fd);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("too long");
  });

  it("accepts a name of exactly 80 characters", () => {
    const fd = buildFd({ name: "a".repeat(80) });
    expect(parseSave(fd).success).toBe(true);
  });

  it("requires the version token when editing", () => {
    const fd = buildFd({ seen_updated_at: "" });
    const r = parseSave(fd);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("Reload");
  });

  it("refuses to enable an activity with no enabled templates", () => {
    const form = configToForm(defaultConfig());
    form.templates = form.templates.map((t) => ({ ...t, enabled: false }));
    const fd = buildFd({ config: serializeConfig(form), enabled: "on" });
    const r = parseSave(fd);
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toContain(
        "at least one enabled search template",
      );
  });

  it("allows disabling an activity with no enabled templates", () => {
    const form = configToForm(defaultConfig());
    form.templates = form.templates.map((t) => ({ ...t, enabled: false }));
    const fd = buildFd({ config: serializeConfig(form), enabled: "" });
    expect(parseSave(fd).success).toBe(true);
  });

  it("rejects corrupted JSON in the config field", () => {
    const fd = buildFd({ config: "{broken json" });
    const r = parseSave(fd);
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toContain("could not be read");
  });
});

// ---------------------------------------------------------------------------
// 7. Reviewer fields
// ---------------------------------------------------------------------------

describe("reviewer fields constraints", () => {
  it("rejects more than 12 reviewer fields", () => {
    const r = parseConfig((raw) => {
      raw.reviewer_fields = Array.from({ length: 13 }, (_, i) => ({
        key: `field${i}`,
        label: `Field ${i}`,
        type: "text",
      }));
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("12");
  });

  it("rejects duplicate reviewer field keys", () => {
    expect(
      msgConfig((raw) => {
        raw.reviewer_fields = [
          { key: "dr", label: "Domain rating", type: "number" },
          { key: "dr", label: "Domain rating 2", type: "number" },
        ];
      }),
    ).toContain("used twice");
  });

  it("rejects a reviewer field key with uppercase letters", () => {
    const r = parseConfig((raw) => {
      raw.reviewer_fields = [
        { key: "DR", label: "Domain Rating", type: "number" },
      ];
    });
    expect(r.success).toBe(false);
  });

  it("rejects a reviewer field label > 40 characters", () => {
    const r = parseConfig((raw) => {
      raw.reviewer_fields = [
        { key: "dr", label: "a".repeat(41), type: "number" },
      ];
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("too long");
  });

  it("accepts exactly 12 reviewer fields", () => {
    expect(
      parseConfig((raw) => {
        raw.reviewer_fields = Array.from({ length: 12 }, (_, i) => ({
          key: `field${i}`,
          label: `Field ${i}`,
          type: "text",
        }));
      }).success,
    ).toBe(true);
  });
});
