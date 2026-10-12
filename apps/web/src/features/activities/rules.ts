import type {
  ActivityConfig,
  FootprintTemplate,
  ScoringWeights,
} from "./types";

// ---------------------------------------------------------------------
// Search templates
// ---------------------------------------------------------------------

export const PLACEHOLDERS = [
  "keyword",
  "niche",
  "brand",
  "country",
  "city",
] as const;

export const PLACEHOLDER_HELP: Record<(typeof PLACEHOLDERS)[number], string> = {
  keyword: "one of the job's seed keywords",
  niche: "the job's business type or sub-niche",
  brand: "the client's brand name",
  country: "the job's country",
  city: "one of the job's cities or regions",
};

const SAMPLE: Record<string, string> = {
  keyword: "yoga retreat",
  niche: "yoga",
  brand: "Acme Yoga",
  country: "India",
  city: "Pune",
};

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

export const TEMPLATE_MAX_LENGTH = 300;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Why a template cannot be saved, or null when it is fine. */
export function templateProblem(raw: string): string | null {
  const t = collapse(raw);
  if (!t) return "Enter the search text.";
  if (t.length > TEMPLATE_MAX_LENGTH) {
    return `Search text is too long (${TEMPLATE_MAX_LENGTH} characters max).`;
  }
  const names = [...t.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? "");
  const unknown = names.find(
    (n) => !(PLACEHOLDERS as readonly string[]).includes(n),
  );
  if (unknown !== undefined) {
    return `{${unknown}} is not a placeholder. Use ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`;
  }
  if (/[{}]/.test(t.replace(PLACEHOLDER_RE, ""))) {
    return "A curly brace is not part of a placeholder. Remove it or close it.";
  }
  if (names.length === 0) {
    return "Use at least one placeholder, for example {keyword}.";
  }
  return null;
}

/** The query a template would produce for sample values. For the preview. */
export function renderTemplate(
  raw: string,
  values: Record<string, string> = SAMPLE,
): string {
  return collapse(raw).replace(
    PLACEHOLDER_RE,
    (whole, name: string) => values[name] ?? whole,
  );
}

/** Templates in run order. Equal priorities keep the order they were in. */
export function sortTemplates(
  templates: readonly FootprintTemplate[],
): FootprintTemplate[] {
  return templates
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.priority - b.t.priority || a.i - b.i)
    .map(({ t }) => t);
}

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------

export const WEIGHT_PARTS = [
  ["relevance", "Relevance"],
  ["language_region", "Language and region"],
  ["activity_fit", "Activity fit"],
  ["overlap", "Overlap with competitors"],
  ["multi_query", "Found by many queries"],
] as const satisfies readonly (readonly [keyof ScoringWeights, string])[];

/** Sum of the five positive parts. Must be 100 to save. */
export function weightsTotal(w: Omit<ScoringWeights, "spam_penalty">): number {
  return (
    w.relevance + w.language_region + w.activity_fit + w.overlap + w.multi_query
  );
}

export const FIELD_WEIGHT_PARTS = [
  ["title", "Title"],
  ["headings", "Headings"],
  ["meta", "Meta description"],
  ["body", "Body text"],
] as const;

// ---------------------------------------------------------------------
// Defaults for a new activity
// ---------------------------------------------------------------------

export function defaultConfig(): ActivityConfig {
  return {
    footprint_templates: [
      {
        id: "t_start",
        template: "{keyword}",
        language: "*",
        priority: 1,
        enabled: true,
      },
    ],
    page_type_signals: {
      url_patterns: [],
      title_phrases: [],
      heading_phrases: [],
      body_phrases: [],
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
    per_domain_cap: 5,
    reviewer_fields: [],
  };
}

/** Lowercase letters, digits and underscores. Used to suggest a key. */
export function suggestKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 50);
  return k.length >= 2 ? k : "";
}
