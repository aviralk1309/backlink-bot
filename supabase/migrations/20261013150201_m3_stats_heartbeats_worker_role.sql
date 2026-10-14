-- M3-S3 (3 of 3): live counters, worker heartbeats, and the `worker` role.
--
-- Design notes
--  * job_stats has one row per job, created by a trigger on jobs (and
--    back-filled here), so counter updates are plain `x = x + 1`.
--  * The worker connects directly to Postgres (ADR 0003) as the `worker` role,
--    not as `postgres`. It has only the table privileges below, and RLS
--    policies that name it. It cannot read profiles, roles or permissions,
--    cannot edit or delete jobs, and cannot call user actions.
--  * The role has no login and no password here, so nothing secret lives in a
--    migration. Local: `alter role worker with login password '...'` in
--    supabase/seed.sql (seed.sql never runs against a hosted project).
--    Hosted: run the same statement once with a real secret (docs/secrets.md).
--  * Policies, not BYPASSRLS, so this also works where only a non-superuser can
--    create roles (hosted Supabase).
--  * `grant worker to postgres` lets the migration owner `set role worker`,
--    which the pgTAP tests do. It adds no privilege to the `worker` role.

-- ---------------------------------------------------------------------
-- job_stats (live counters, spec section 8, M3-S8 keeps them correct)
-- ---------------------------------------------------------------------
create table public.job_stats (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  credits_used integer not null default 0,
  queries_total integer not null default 0,
  queries_done integer not null default 0,
  unique_opportunities integer not null default 0,
  duplicates_skipped integer not null default 0,
  unchecked_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint job_stats_counters_nonneg
    check (
      credits_used >= 0 and queries_total >= 0 and queries_done >= 0
      and unique_opportunities >= 0 and duplicates_skipped >= 0
      and unchecked_count >= 0
    )
);

create trigger job_stats_set_updated_at
  before update on public.job_stats
  for each row execute function public.set_updated_at();

create function public.jobs_create_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_stats (job_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.jobs_create_stats() from public, anon, authenticated;

create trigger jobs_create_stats
  after insert on public.jobs
  for each row execute function public.jobs_create_stats();

insert into public.job_stats (job_id)
select id from public.jobs
on conflict do nothing;

-- ---------------------------------------------------------------------
-- worker_heartbeats (M3-S9 writes them, the admin header reads them)
-- ---------------------------------------------------------------------
create table public.worker_heartbeats (
  worker_id text primary key,
  host text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job_id uuid references public.jobs (id) on delete set null,
  constraint worker_heartbeats_worker_id_not_blank check (length(btrim(worker_id)) > 0),
  constraint worker_heartbeats_host_not_blank check (length(btrim(host)) > 0)
);

create index worker_heartbeats_last_seen_idx
  on public.worker_heartbeats (last_seen_at desc);

create index worker_heartbeats_current_job_idx
  on public.worker_heartbeats (current_job_id)
  where current_job_id is not null;

-- ---------------------------------------------------------------------
-- Client privileges and RLS (read only)
-- ---------------------------------------------------------------------
revoke all on public.job_stats from anon, authenticated;
revoke all on public.worker_heartbeats from anon, authenticated;
grant select on public.job_stats to authenticated;
grant select on public.worker_heartbeats to authenticated;

alter table public.job_stats enable row level security;
alter table public.worker_heartbeats enable row level security;

create policy job_stats_select on public.job_stats
  for select to authenticated
  using (public.has_permission('jobs.view'));

create policy worker_heartbeats_select on public.worker_heartbeats
  for select to authenticated
  using (public.has_permission('system.view_health'));

-- ---------------------------------------------------------------------
-- The worker role (A3, I12)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'worker') then
    create role worker nologin noinherit;
  end if;
end
$$;

grant worker to postgres with set true;

grant usage on schema public to worker;

-- Read-only view of configuration
grant select on public.jobs to worker;
grant select on public.job_config_history to worker;
grant select on public.activity_profiles to worker;
grant select on public.blocklist to worker;

-- The activity log: the worker may append, never edit
grant select, insert on public.job_events to worker;

-- Pipeline tables
grant select, insert, update on public.opportunities to worker;
grant select, insert on public.opportunity_sources to worker;
grant select, insert, update on public.domains to worker;
grant select, insert on public.job_domains to worker;
grant select, update on public.job_stats to worker;
grant select, insert, update, delete on public.worker_heartbeats to worker;

-- Job lifecycle for the worker: pick_up, complete, saturate, fail.
-- Users call transition_job instead; the worker may not.
grant execute on function public.worker_transition_job(uuid, text, text) to worker;

-- RLS policies naming the worker. Grants above are the real limit.
create policy worker_select on public.jobs
  for select to worker using (true);
create policy worker_select on public.job_config_history
  for select to worker using (true);
create policy worker_select on public.activity_profiles
  for select to worker using (true);
create policy worker_select on public.blocklist
  for select to worker using (true);

create policy worker_select on public.job_events
  for select to worker using (true);
create policy worker_insert on public.job_events
  for insert to worker with check (true);

create policy worker_all on public.opportunities
  for all to worker using (true) with check (true);
create policy worker_all on public.opportunity_sources
  for all to worker using (true) with check (true);
create policy worker_all on public.domains
  for all to worker using (true) with check (true);
create policy worker_all on public.job_domains
  for all to worker using (true) with check (true);
create policy worker_all on public.job_stats
  for all to worker using (true) with check (true);
create policy worker_all on public.worker_heartbeats
  for all to worker using (true) with check (true);