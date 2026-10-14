export const JOB_STATUSES = [
  "draft",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "saturated",
  "stopped",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** What a signed-in user can ask for. Worker actions are not listed here. */
export const JOB_ACTIONS = ["start", "pause", "resume", "stop"] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

/** Stored as jsonb on the job. Only non-empty keys are present. */
export type LocalBusiness = {
  name?: string;
  address?: string;
  phone?: string;
};

/** One row of public.jobs, as the dashboard reads it. */
export type JobRow = {
  id: string;
  job_type: string;
  name: string;
  client: string | null;
  client_domain: string | null;
  target_urls: string[];
  business_type: string | null;
  sub_niche: string | null;
  activity_keys: string[];
  country: string | null;
  language: string | null;
  regions: string[];
  seed_keywords: string[];
  brand_variants: string[];
  competitor_domains: string[];
  reference_sites: string[];
  seed_list_urls: string[];
  banned_categories: string[];
  blocked_domains: string[];
  require_language_region_match: boolean;
  budget_credits: number;
  pages_per_query: number;
  saturation_n: number;
  saturation_x: number;
  per_domain_cap: number;
  review_queue_size: number;
  skip_previously_spam_domains: boolean;
  scrape_credit_cap: number;
  local_business: LocalBusiness | null;
  status: JobStatus;
  status_reason: string | null;
  config_version: number;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** The columns the jobs list needs. */
export type JobListItem = Pick<
  JobRow,
  | "id"
  | "name"
  | "client"
  | "client_domain"
  | "status"
  | "status_reason"
  | "config_version"
  | "activity_keys"
  | "created_at"
  | "updated_at"
  | "started_at"
  | "finished_at"
>;

/** One line of the job activity log (public.job_events). */
export type JobEvent = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  /** Null when the viewer is not allowed to read that profile. */
  actor_name: string | null;
  config_version: number | null;
  created_at: string;
};

/** What the job form needs to know about an activity profile. */
export type ActivityOption = {
  key: string;
  name: string;
  enabled: boolean;
};

/** One row of public.job_stats, the live counters on the Overview tab. */
export type JobStats = {
  credits_used: number;
  queries_total: number;
  queries_done: number;
  unique_opportunities: number;
  duplicates_skipped: number;
  unchecked_count: number;
};

/** The route and the Overview tab share this shape. */
export type JobLive = { status: JobStatus; stats: JobStats };

export const EMPTY_JOB_STATS: JobStats = {
  credits_used: 0,
  queries_total: 0,
  queries_done: 0,
  unique_opportunities: 0,
  duplicates_skipped: 0,
  unchecked_count: 0,
};
