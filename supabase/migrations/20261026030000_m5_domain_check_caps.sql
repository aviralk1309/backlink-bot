-- Pin activity overrides at config-snapshot creation, not during page fetching.
create function public.capture_activity_check_caps()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.snapshot := new.snapshot || jsonb_build_object('activity_check_caps', coalesce((
    select jsonb_object_agg(a.key, a.per_domain_cap)
    from public.activity_profiles a
    where a.enabled and a.key in (
      select jsonb_array_elements_text(coalesce(new.snapshot->'activity_keys', '[]'::jsonb))
    )
  ), '{}'::jsonb));
  return new;
end;
$$;
revoke all on function public.capture_activity_check_caps() from public, anon, authenticated, service_role, worker;
create trigger capture_activity_check_caps before insert on public.job_config_history
  for each row execute function public.capture_activity_check_caps();

create table public.domain_check_budgets (
  job_id uuid not null references public.jobs(id) on delete cascade,
  domain text not null,
  cap_limit integer not null check (cap_limit >= 1),
  config_version integer not null check (config_version >= 1),
  admitted_count integer not null default 0 check (admitted_count >= 0),
  primary key (job_id, domain)
);
create table public.opportunity_check_admissions (
  opportunity_id uuid primary key references public.opportunities(id) on delete cascade,
  job_id uuid not null,
  domain text not null,
  admitted_at timestamptz not null default now(),
  foreign key (job_id, domain) references public.domain_check_budgets(job_id, domain) on delete cascade
);
create index opportunity_check_admissions_domain_idx on public.opportunity_check_admissions(job_id, domain);
alter table public.domain_check_budgets enable row level security;
alter table public.opportunity_check_admissions enable row level security;
revoke all on public.domain_check_budgets, public.opportunity_check_admissions
  from public, anon, authenticated, service_role, worker;
grant select on public.domain_check_budgets, public.opportunity_check_admissions to worker;
create policy worker_read on public.domain_check_budgets for select to worker using (true);
create policy worker_read on public.opportunity_check_admissions for select to worker using (true);

-- Existing consumed work must not acquire a second allowance on deployment.
insert into public.domain_check_budgets(job_id, domain, cap_limit, config_version, admitted_count)
select o.job_id, o.domain, j.per_domain_cap, j.config_version, count(*)::integer
from public.opportunities o join public.jobs j on j.id = o.job_id
where o.attempts > 0 or o.check_status in ('running', 'done')
group by o.job_id, o.domain, j.per_domain_cap, j.config_version;
insert into public.opportunity_check_admissions(opportunity_id, job_id, domain)
select id, job_id, domain from public.opportunities
where attempts > 0 or check_status in ('running', 'done');

create index opportunities_domain_pending_rank_idx on public.opportunities
  (job_id, domain, overlap_count desc, created_at, id)
  where check_status = 'pending' and duplicate_of is null;

create or replace function public.claim_opportunity_checks(
  p_worker_id text, p_batch integer default 10, p_lease_seconds integer default 120
) returns table (
  id uuid, job_id uuid, original_url text, normalized_url text, host text, domain text,
  activity_key text, priority smallint, config_version integer, attempts integer,
  lease_expires_at timestamptz
) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_job public.jobs;
  v_domain text;
  v_row public.opportunities;
  v_budget public.domain_check_budgets;
  v_snapshot jsonb;
  v_cap integer;
  v_claimed integer := 0;
  v_examined integer := 0;
  v_admitted boolean;
begin
  if p_worker_id is null or length(btrim(p_worker_id)) = 0 then raise exception 'invalid_worker_id'; end if;
  if p_batch is null or p_batch not between 1 and 100 then raise exception 'invalid_batch'; end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then raise exception 'invalid_lease_seconds'; end if;

  -- Serialize short admission transactions per job. FK key-share locks from
  -- discovery remain compatible. Other workers skip to another eligible job.
  for v_job in
    select j.* from public.jobs j
    where j.status in ('running', 'saturated') and exists (
      select 1 from public.opportunities o where o.job_id = j.id and o.check_status = 'pending'
        and o.duplicate_of is null and o.queue_group is distinct from 'auto_filtered'
    )
    order by (select min(o.priority) from public.opportunities o
              where o.job_id = j.id and o.check_status = 'pending'), j.created_at, j.id
    limit p_batch for no key update of j skip locked
  loop
    select h.snapshot into v_snapshot from public.job_config_history h
      where h.job_id = v_job.id and h.version = v_job.config_version;
    -- Legacy snapshots have no activity overrides: use their frozen job cap.
    v_cap := coalesce((v_snapshot->>'per_domain_cap')::integer, v_job.per_domain_cap);
    select coalesce(max(value::integer), v_cap) into v_cap
      from jsonb_each_text(coalesce(v_snapshot->'activity_check_caps', '{}'::jsonb));

    for v_domain in
      select o.domain from public.opportunities o
      where o.job_id = v_job.id and o.check_status = 'pending' and o.duplicate_of is null
        and o.queue_group is distinct from 'auto_filtered'
      group by o.domain order by min(o.priority), min(o.created_at), o.domain limit 100
    loop
      insert into public.domain_check_budgets(job_id, domain, cap_limit, config_version)
        values (v_job.id, v_domain, v_cap, v_job.config_version) on conflict do nothing;
      select * into v_budget from public.domain_check_budgets b
        where b.job_id = v_job.id and b.domain = v_domain for update;

      -- Do not SKIP LOCKED within a domain: skipping a high-ranked row could
      -- spend the last slot on a lower-ranked row. Job admission is serialized.
      for v_row in
        select o.* from public.opportunities o
        where o.job_id = v_job.id and o.domain = v_domain and o.check_status = 'pending'
          and o.duplicate_of is null and o.queue_group is distinct from 'auto_filtered'
        order by o.overlap_count desc,
          (select count(*) from public.opportunity_sources s
           where s.opportunity_id = o.id and s.source_type = 'google') desc,
          o.created_at, o.id
        limit 1000 for update of o
      loop
        v_examined := v_examined + 1;
        select exists(select 1 from public.opportunity_check_admissions a
          where a.opportunity_id = v_row.id) into v_admitted;
        if not v_admitted and v_budget.admitted_count >= v_budget.cap_limit then
          update public.opportunities o set check_status = 'skipped', check_reason = 'domain_cap',
            tier = 'unchecked', queue_group = 'backlog', score = null, score_breakdown = null,
            locked_by = null, lease_expires_at = null
            where o.id = v_row.id;
          -- The existing deferred unchecked-count trigger owns job_stats.
        else
          if not v_admitted then
            insert into public.opportunity_check_admissions(opportunity_id, job_id, domain)
              values (v_row.id, v_job.id, v_domain);
            update public.domain_check_budgets b set admitted_count = admitted_count + 1
              where b.job_id = v_job.id and b.domain = v_domain
              returning * into v_budget;
          end if;
          return query update public.opportunities o set check_status = 'running',
            locked_by = p_worker_id, lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
            attempts = o.attempts + 1
            where o.id = v_row.id
            returning o.id, o.job_id, o.original_url, o.normalized_url, o.host, o.domain,
                      o.activity_key, o.priority, o.config_version, o.attempts, o.lease_expires_at;
          v_claimed := v_claimed + 1;
        end if;
        if v_claimed >= p_batch or v_examined >= 1000 then return; end if;
      end loop;
    end loop;
  end loop;
end;
$$;
revoke all on function public.claim_opportunity_checks(text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_opportunity_checks(text,integer,integer) to worker;
