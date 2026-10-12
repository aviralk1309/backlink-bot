import { sortTemplates } from "./rules";
import type {
  ActivityConfig,
  ActivityProfileRow,
  ReviewerFieldType,
} from "./types";

// The form keeps every number as text, so a half-typed or empty box is not
// forced to 0 while the person is typing. serializeConfig turns the text into
// numbers (blank or invalid becomes null, which the server reports by name).

export type FormTemplate = {
  id: string;
  template: string;
  language: string;
  priority: string;
  enabled: boolean;
};

export type FormReviewerField = {
  key: string;
  label: string;
  type: ReviewerFieldType;
};

export type FormConfig = {
  per_domain_cap: string;
  templates: FormTemplate[];
  url_patterns: string[];
  title_phrases: string[];
  heading_phrases: string[];
  body_phrases: string[];
  link_list: boolean;
  min_outbound_links: string;
  fw_title: string;
  fw_headings: string;
  fw_meta: string;
  fw_body: string;
  min_score: string;
  w_relevance: string;
  w_language_region: string;
  w_activity_fit: string;
  w_overlap: string;
  w_multi_query: string;
  w_spam_penalty: string;
  reviewer_fields: FormReviewerField[];
};

export type ActivityFormValues = {
  /** null when creating. */
  id: string | null;
  key: string;
  name: string;
  enabled: boolean;
  /** For the lost-update check. Empty when creating. */
  updatedAt: string;
  version: number | null;
  config: FormConfig;
};

const s = (n: number) => String(n);

export function configToForm(c: ActivityConfig): FormConfig {
  const sig = c.page_type_signals;
  const fw = c.relevance_rule.field_weights;
  const w = c.scoring_weights;
  return {
    per_domain_cap: s(c.per_domain_cap),
    templates: sortTemplates(c.footprint_templates).map((t) => ({
      id: t.id,
      template: t.template,
      language: t.language,
      priority: s(t.priority),
      enabled: t.enabled,
    })),
    url_patterns: [...sig.url_patterns],
    title_phrases: [...sig.title_phrases],
    heading_phrases: [...sig.heading_phrases],
    body_phrases: [...sig.body_phrases],
    link_list: sig.structure.link_list,
    min_outbound_links: s(sig.structure.min_outbound_links),
    fw_title: s(fw.title),
    fw_headings: s(fw.headings),
    fw_meta: s(fw.meta),
    fw_body: s(fw.body),
    min_score: s(c.relevance_rule.min_score),
    w_relevance: s(w.relevance),
    w_language_region: s(w.language_region),
    w_activity_fit: s(w.activity_fit),
    w_overlap: s(w.overlap),
    w_multi_query: s(w.multi_query),
    w_spam_penalty: s(w.spam_penalty),
    reviewer_fields: c.reviewer_fields.map((f) => ({ ...f })),
  };
}

export function profileToFormValues(p: ActivityProfileRow): ActivityFormValues {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    enabled: p.enabled,
    updatedAt: p.updated_at,
    version: p.version,
    config: configToForm(p),
  };
}

/** Text to a number. Blank or not a number is null, never 0. */
export function toNumber(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The JSON the server reads. Keys match saveActivitySchema's config. */
export function serializeConfig(f: FormConfig): string {
  const n = toNumber;
  return JSON.stringify({
    per_domain_cap: n(f.per_domain_cap),
    footprint_templates: f.templates.map((t) => ({
      id: t.id,
      template: t.template,
      language: t.language,
      priority: n(t.priority),
      enabled: t.enabled,
    })),
    page_type_signals: {
      url_patterns: f.url_patterns,
      title_phrases: f.title_phrases,
      heading_phrases: f.heading_phrases,
      body_phrases: f.body_phrases,
      structure: {
        link_list: f.link_list,
        min_outbound_links: n(f.min_outbound_links),
      },
    },
    relevance_rule: {
      field_weights: {
        title: n(f.fw_title),
        headings: n(f.fw_headings),
        meta: n(f.fw_meta),
        body: n(f.fw_body),
      },
      min_score: n(f.min_score),
    },
    scoring_weights: {
      relevance: n(f.w_relevance),
      language_region: n(f.w_language_region),
      activity_fit: n(f.w_activity_fit),
      overlap: n(f.w_overlap),
      multi_query: n(f.w_multi_query),
      spam_penalty: n(f.w_spam_penalty),
    },
    reviewer_fields: f.reviewer_fields,
  });
}

/** A fresh id for a template row added in the browser. */
export function newTemplateId(): string {
  return `t_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

/** The next free priority, so a new row goes last. */
export function nextPriority(templates: readonly FormTemplate[]): string {
  const max = templates.reduce(
    (m, t) => Math.max(m, toNumber(t.priority) ?? 0),
    0,
  );
  return String(Math.min(max + 1, 99));
}

/** Live total of the five positive weights, ignoring blanks. */
export function formWeightsTotal(f: FormConfig): number {
  return (
    (toNumber(f.w_relevance) ?? 0) +
    (toNumber(f.w_language_region) ?? 0) +
    (toNumber(f.w_activity_fit) ?? 0) +
    (toNumber(f.w_overlap) ?? 0) +
    (toNumber(f.w_multi_query) ?? 0)
  );
}

/** Chip options for the phrase lists. Keep in sync with phrases() in schemas.ts. */
export const FORM_LIMITS = {
  phrases: { kind: "text", max: 30, maxLen: 100, lower: true },
} as const;
