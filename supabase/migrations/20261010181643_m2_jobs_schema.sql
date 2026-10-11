-- M2-S1: jobs schema (activity_profiles, jobs, job_config_history,
-- job_events, blocklist).
--
-- Design notes
--  * A Draft can be saved half-empty, so only `name` is required here.
--    "Ready to start" rules live in transition_job() (M2-S6), not in
--    NOT NULL constraints.
--  * `status` and `config_version` are never written by clients. They move
--    only through transition_job() and the versioning trigger (both in the
--    next migration). RLS migration enforces this with column grants.
--  * Lists are text[] / jsonb (M2-D1). Domain and URL normalization is done
--    in the app now and by the M3 normalizer later.
--  * Activity keys on a job are validated at start time, not by FK, because
--    jobs hold an array of keys.

create type public.job_status as enum (
  'draft',
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'saturated',
  'stopped'
);

-- ---------------------------------------------------------------------
-- activity_profiles (spec section 13)
-- ---------------------------------------------------------------------
create table public.activity_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  enabled boolean not null default true,
  footprint_templates jsonb not null default '[]'::jsonb,
  page_type_signals jsonb not null default '{}'::jsonb,
  relevance_rule jsonb not null default '{}'::jsonb,
  scoring_weights jsonb not null default '{}'::jsonb,
  per_domain_cap integer not null default 10,
  reviewer_fields jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_profiles_key_key unique (key),
  constraint activity_profiles_key_format
    check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint activity_profiles_name_not_blank
    check (length(btrim(name)) > 0),
  constraint activity_profiles_templates_array
    check (jsonb_typeof(footprint_templates) = 'array'),
  constraint activity_profiles_signals_object
    check (jsonb_typeof(page_type_signals) = 'object'),
  constraint activity_profiles_relevance_object
    check (jsonb_typeof(relevance_rule) = 'object'),
  constraint activity_profiles_weights_object
    check (jsonb_typeof(scoring_weights) = 'object'),
  constraint activity_profiles_reviewer_fields_array
    check (jsonb_typeof(reviewer_fields) = 'array'),
  constraint activity_profiles_cap_range
    check (per_domain_cap between 1 and 1000)
);

create trigger activity_profiles_set_updated_at
  before update on public.activity_profiles
  for each row execute function public.set_updated_at();

-- Version bumps only when something real changed, so a no-op save does not
-- create a new version (scores record the version they used).
create function public.bump_activity_profile_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'version' - 'updated_at')
     is distinct from (to_jsonb(old) - 'version' - 'updated_at') then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create trigger activity_profiles_bump_version
  before update on public.activity_profiles
  for each row execute function public.bump_activity_profile_version();

-- ---------------------------------------------------------------------
-- jobs (spec section 5)
-- ---------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'search_backlinks',
  name text not null,

  -- Basics
  client text,
  client_domain text,
  target_urls text[] not null default '{}',
  business_type text,
  sub_niche text,

  -- Activities in scope (keys of activity_profiles)
  activity_keys text[] not null default '{}',

  -- Targeting
  country text,
  language text,
  regions text[] not null default '{}',
  seed_keywords text[] not null default '{}',
  brand_variants text[] not null default '{}',

  -- Discovery sources
  competitor_domains text[] not null default '{}',
  reference_sites text[] not null default '{}',
  seed_list_urls text[] not null default '{}',

  -- Filters
  banned_categories text[] not null default '{}',
  blocked_domains text[] not null default '{}',
  require_language_region_match boolean not null default false,

  -- Limits
  budget_credits integer not null default 0,
  pages_per_query integer not null default 1,
  saturation_n integer not null default 20,
  saturation_x integer not null default 3,
  per_domain_cap integer not null default 10,
  review_queue_size integer not null default 50,
  skip_previously_spam_domains boolean not null default false,
  scrape_credit_cap integer not null default 0,

  -- Local business data (stored only in v1, G7)
  local_business jsonb,

  -- Lifecycle (changed only by SQL functions, never by clients)
  status public.job_status not null default 'draft',
  config_version integer not null default 1,

  created_by uuid default auth.uid()
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint jobs_job_type_check check (job_type = 'search_backlinks'),
  constraint jobs_name_not_blank check (length(btrim(name)) > 0),
  constraint jobs_country_format
    check (country is null or country ~ '^[A-Z]{2}$'),
  constraint jobs_language_format
    check (language is null or language ~ '^[a-z]{2}$'),
  constraint jobs_budget_range check (budget_credits >= 0),
  constraint jobs_pages_per_query_range
    check (pages_per_query between 1 and 10),
  constraint jobs_saturation_n_range check (saturation_n >= 1),
  constraint jobs_saturation_x_range check (saturation_x >= 0),
  constraint jobs_per_domain_cap_range check (per_domain_cap >= 1),
  constraint jobs_review_queue_size_range
    check (review_queue_size between 1 and 500),
  constraint jobs_scrape_credit_cap_range check (scrape_credit_cap >= 0),
  constraint jobs_local_business_object
    check (local_business is null or jsonb_typeof(local_business) = 'object'),
  constraint jobs_config_version_positive check (config_version >= 1)
);

create index jobs_status_idx on public.jobs (status);
create index jobs_created_at_idx on public.jobs (created_at desc, id desc);
create index jobs_created_by_idx on public.jobs (created_by);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- job_config_history (A5): one snapshot per config_version
-- ---------------------------------------------------------------------
create table public.job_config_history (
  job_id uuid not null references public.jobs (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (job_id, version),
  constraint job_config_history_snapshot_object
    check (jsonb_typeof(snapshot) = 'object')
);

-- ---------------------------------------------------------------------
-- job_events: append-only activity log
-- ---------------------------------------------------------------------
create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles (id) on delete set null,
  config_version integer,
  created_at timestamptz not null default now(),
  constraint job_events_type_not_blank check (length(btrim(type)) > 0),
  constraint job_events_payload_object
    check (jsonb_typeof(payload) = 'object')
);

create index job_events_job_created_idx
  on public.job_events (job_id, created_at desc, id desc);

-- ---------------------------------------------------------------------
-- blocklist (global, G9: hard auto-filter, never fetched)
-- ---------------------------------------------------------------------
create table public.blocklist (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  reason text,
  added_by uuid default auth.uid()
    references public.profiles (id) on delete set null,
  source_job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint blocklist_domain_key unique (domain),
  -- Registered domain, lowercase, no scheme, path or spaces. The app
  -- normalizes first; this is the safety net.
  constraint blocklist_domain_format
    check (domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$')
);

create index blocklist_source_job_idx on public.blocklist (source_job_id);