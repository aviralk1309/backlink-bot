export const REVIEWER_FIELD_TYPES = ["text", "number", "url"] as const;
export type ReviewerFieldType = (typeof REVIEWER_FIELD_TYPES)[number];

/** One search query pattern. Language "*" means every language. */
export type FootprintTemplate = {
  id: string;
  template: string;
  language: string;
  /** 1 runs first. */
  priority: number;
  enabled: boolean;
};

export type PageTypeSignals = {
  url_patterns: string[];
  title_phrases: string[];
  heading_phrases: string[];
  body_phrases: string[];
  structure: { link_list: boolean; min_outbound_links: number };
};

export type RelevanceRule = {
  field_weights: {
    title: number;
    headings: number;
    meta: number;
    body: number;
  };
  /** 0 to 1. */
  min_score: number;
};

/** Positive parts add up to 100. spam_penalty is a cap, not a part. */
export type ScoringWeights = {
  relevance: number;
  language_region: number;
  activity_fit: number;
  overlap: number;
  multi_query: number;
  spam_penalty: number;
};

export type ReviewerField = {
  key: string;
  label: string;
  type: ReviewerFieldType;
};

/** Everything an admin can edit except the name, key and on/off switch. */
export type ActivityConfig = {
  footprint_templates: FootprintTemplate[];
  page_type_signals: PageTypeSignals;
  relevance_rule: RelevanceRule;
  scoring_weights: ScoringWeights;
  per_domain_cap: number;
  reviewer_fields: ReviewerField[];
};

/** One row of public.activity_profiles. */
export type ActivityProfileRow = ActivityConfig & {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ActivityListItem = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  per_domain_cap: number;
  version: number;
  updated_at: string;
  template_count: number;
  enabled_template_count: number;
};
