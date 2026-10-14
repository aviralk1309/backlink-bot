-- M3-S3 (2 of 3): domain-level cache and per-job seen domains.
--
-- Design notes
--  * `domains` is a cache keyed by registered domain, shared by all jobs
--    (TTL 7 days, G14). It never stores page bodies (G19). robots.txt is
--    capped at 512 KiB, which is also protego's own limit.
--  * `global_spam` is the flag set by a spam reject in M6 (G9). It is a warning
--    with a per-job skip option, not the hard blocklist.
--  * `job_domains` records the first time a registered domain is seen in a job
--    from any source. "New unique domain" for saturation (G11) is a successful
--    insert here, so M8 never has to count over opportunities.
--  * Neither table is written by clients.

create table public.domains (
  registered_domain text primary key,

  robots_txt text,
  robots_fetched_at timestamptz,

  -- Cloudflare-style blocking seen on this domain: other pages short-circuit
  -- to "could not check" instead of hammering it (M5-S2).
  blocked_suspected boolean not null default false,
  blocked_suspected_at timestamptz,

  tld_flags jsonb not null default '{}'::jsonb,
  has_contact_page boolean,
  has_about_page boolean,
  last_fetch_status text,
  last_fetch_at timestamptz,
  checked_at timestamptz,

  -- Global spam flag (G9)
  global_spam boolean not null default false,
  global_spam_at timestamptz,
  global_spam_by uuid references public.profiles (id) on delete set null,
  global_spam_job_id uuid references public.jobs (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint domains_registered_domain_format
    check (registered_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$'),
  constraint domains_robots_size
    check (robots_txt is null or octet_length(robots_txt) <= 524288),
  constraint domains_tld_flags_object check (jsonb_typeof(tld_flags) = 'object'),
  constraint domains_spam_has_time check (not global_spam or global_spam_at is not null)
);

create index domains_global_spam_job_idx
  on public.domains (global_spam_job_id)
  where global_spam_job_id is not null;

create trigger domains_set_updated_at
  before update on public.domains
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- job_domains (G11)
-- ---------------------------------------------------------------------
create table public.job_domains (
  job_id uuid not null references public.jobs (id) on delete cascade,
  registered_domain text not null,
  first_source_type text not null,
  first_seen_at timestamptz not null default now(),
  primary key (job_id, registered_domain),
  constraint job_domains_domain_format
    check (registered_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$'),
  constraint job_domains_first_source_type_check
    check (first_source_type in ('google', 'competitor_csv', 'seed_list'))
);

-- ---------------------------------------------------------------------
-- Privileges and RLS. Clients may only read.
-- ---------------------------------------------------------------------
revoke all on public.domains from anon, authenticated;
revoke all on public.job_domains from anon, authenticated;
grant select on public.domains to authenticated;
grant select on public.job_domains to authenticated;

alter table public.domains enable row level security;
alter table public.job_domains enable row level security;

create policy domains_select on public.domains
  for select to authenticated
  using (public.has_permission('results.view'));

create policy job_domains_select on public.job_domains
  for select to authenticated
  using (public.has_permission('jobs.view'));