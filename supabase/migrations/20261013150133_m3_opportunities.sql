-- M3-S3 (1 of 3): opportunities and their "found by" records.
--
-- Design notes
--  * The worker normalizes URLs (apps/worker/src/worker/urls) and passes the
--    result in. This table only checks the shape, it does not compute it.
--  * One row per (job, normalized URL). The same URL may exist in other jobs (I7).
--  * Every opportunity is stored, including failed, skipped and auto-filtered
--    ones, and each of those carries a reason (I3). Check constraints enforce it.
--  * No client ever writes these tables. The worker connects with the `worker`
--    role (migration 3 of 3). Review fields arrive in M6 as a new migration.
--  * `priority` makes gap rows run before search rows (I6):
--    0 = competitor CSV, 1 = seed list, 2 = google search.
--  * `domain` is the registered domain (tldextract), `host` is the full host.
--    Neither is a foreign key: the `domains` cache row is created lazily.
--  * The claim indexes are partial, so they stay small while most rows are done.

create type public.opportunity_check_status as enum (
  'pending',
  'running',
  'done',
  'failed',
  'skipped'
);

create type public.opportunity_queue_group as enum (
  'auto_filtered',
  'ready',
  'backlog'
);

create type public.opportunity_tier as enum (
  'high',
  'medium',
  'low',
  'unchecked'
);

-- ---------------------------------------------------------------------
-- opportunities
-- ---------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,

  original_url text not null,
  normalized_url text not null,
  host text not null,
  domain text not null,

  -- Source summary. Every source is in opportunity_sources.
  first_source_type text not null,
  found_by_count integer not null default 1,
  activity_key text,

  -- 0 = competitor CSV, 1 = seed list, 2 = google search (I6)
  priority smallint not null default 2,
  overlap_count integer not null default 0,
  client_link_status text not null default 'unknown',

  -- Check pipeline (A6) and lease (A2)
  check_status public.opportunity_check_status not null default 'pending',
  check_reason text,
  locked_by text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,

  -- Queue group and score (set after scoring, M5)
  queue_group public.opportunity_queue_group,
  filter_reason text,
  score numeric(5, 2),
  tier public.opportunity_tier,
  score_breakdown jsonb,

  -- Config version in force when the row was discovered (A5, I8)
  config_version integer not null,

  fetch_summary jsonb,
  flags jsonb not null default '{}'::jsonb,
  extras jsonb not null default '{}'::jsonb,

  -- Post-fetch merge: a redirect or canonical pointed at an existing row
  duplicate_of uuid references public.opportunities (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint opportunities_job_url_key unique (job_id, normalized_url),
  constraint opportunities_original_url_length
    check (char_length(original_url) between 1 and 4096),
  constraint opportunities_normalized_url_https
    check (normalized_url ~ '^https://[^[:space:]]+$' and char_length(normalized_url) <= 2100),
  constraint opportunities_host_not_blank check (length(btrim(host)) > 0),
  -- Same shape as blocklist.domain
  constraint opportunities_domain_format
    check (domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$'),
  constraint opportunities_first_source_type_check
    check (first_source_type in ('google', 'competitor_csv', 'seed_list')),
  constraint opportunities_found_by_count_range check (found_by_count >= 1),
  constraint opportunities_priority_range check (priority between 0 and 9),
  constraint opportunities_overlap_count_range check (overlap_count >= 0),
  constraint opportunities_client_link_status_check
    check (client_link_status in ('unknown', 'known_partial')),
  constraint opportunities_attempts_range check (attempts >= 0),
  -- A claimed row always has an owner and a lease, or the reaper cannot find it.
  constraint opportunities_running_has_lease
    check (
      check_status <> 'running'
      or (locked_by is not null and lease_expires_at is not null)
    ),
  -- I3: failed and skipped rows say why.
  constraint opportunities_skipped_has_reason
    check (check_status not in ('skipped', 'failed') or check_reason is not null),
  -- I3: auto-filtered rows say why, and only they carry a filter reason.
  constraint opportunities_filtered_has_reason
    check (queue_group is distinct from 'auto_filtered' or filter_reason is not null),
  constraint opportunities_filter_reason_group
    check (filter_reason is null or queue_group = 'auto_filtered'),
  constraint opportunities_score_range check (score is null or score between 0 and 100),
  constraint opportunities_config_version_positive check (config_version >= 1),
  constraint opportunities_duplicate_not_self check (duplicate_of is distinct from id),
  constraint opportunities_score_breakdown_object
    check (score_breakdown is null or jsonb_typeof(score_breakdown) = 'object'),
  constraint opportunities_fetch_summary_object
    check (fetch_summary is null or jsonb_typeof(fetch_summary) = 'object'),
  constraint opportunities_flags_object check (jsonb_typeof(flags) = 'object'),
  constraint opportunities_extras_object check (jsonb_typeof(extras) = 'object')
);

-- Claim: pending rows, gap first (I6), oldest first. M3-S6 adds the job filter.
create index opportunities_claim_idx
  on public.opportunities (priority, created_at, id)
  where check_status = 'pending';

-- Reaper: running rows whose lease ran out.
create index opportunities_lease_idx
  on public.opportunities (lease_expires_at)
  where check_status = 'running';

-- Ranking: the order of the review queue. Ties: more overlap, then older.
create index opportunities_ranking_idx
  on public.opportunities (
    job_id, queue_group, score desc nulls last, overlap_count desc, created_at, id
  );

-- Per-domain cap and group-by-domain.
create index opportunities_job_domain_idx
  on public.opportunities (job_id, domain);

-- Keeps ON DELETE SET NULL on duplicate_of cheap.
create index opportunities_duplicate_of_idx
  on public.opportunities (duplicate_of)
  where duplicate_of is not null;

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- opportunity_sources: every query or upload that found an opportunity
-- ---------------------------------------------------------------------
create table public.opportunity_sources (
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  source_type text not null,
  -- google: query id. competitor_csv: competitor label. seed_list: any fixed text.
  source_ref text not null,
  found_at timestamptz not null default now(),
  primary key (opportunity_id, source_type, source_ref),
  constraint opportunity_sources_source_type_check
    check (source_type in ('google', 'competitor_csv', 'seed_list')),
  constraint opportunity_sources_ref_not_blank check (length(btrim(source_ref)) > 0)
);

-- Reports join sources to queries and uploads (M7).
create index opportunity_sources_ref_idx
  on public.opportunity_sources (source_type, source_ref);

-- ---------------------------------------------------------------------
-- Privileges and RLS. Clients may only read.
-- ---------------------------------------------------------------------
revoke all on public.opportunities from anon, authenticated;
revoke all on public.opportunity_sources from anon, authenticated;
grant select on public.opportunities to authenticated;
grant select on public.opportunity_sources to authenticated;

alter table public.opportunities enable row level security;
alter table public.opportunity_sources enable row level security;

-- Auto-filtered rows are hidden unless the role may view them (spec 6.5).
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (
    public.has_permission('results.view')
    and (
      queue_group is distinct from 'auto_filtered'
      or public.has_permission('results.view_filtered')
    )
  );

-- Visibility follows the parent row, including its RLS.
create policy opportunity_sources_select on public.opportunity_sources
  for select to authenticated
  using (
    exists (
      select 1 from public.opportunities o where o.id = opportunity_id
    )
  );