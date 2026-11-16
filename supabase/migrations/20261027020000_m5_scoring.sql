-- Global policy is operator-managed data. Initial scoring pins it in job history;
-- only an explicitly confirmed rescore snapshots the current policy again.
create table public.scoring_policy (
  singleton boolean primary key default true check (singleton),
  config jsonb not null check (jsonb_typeof(config) = 'object')
);
insert into public.scoring_policy(config) values ('{
  "version":1,
  "weights":{"relevance":35,"language_region":10,"activity_fit":20,"overlap":20,"multi_query":15,"spam_penalty":30},
  "high_threshold":70,"medium_threshold":40,
  "overlap_half_saturation":2,"query_half_saturation":2,"spam_signal_cap":3
}');
alter table public.scoring_policy enable row level security;
revoke all on public.scoring_policy from anon, authenticated, service_role, worker;

create function public.current_scoring_snapshot(p_keys text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('policy', s.config, 'profiles', coalesce((
    select jsonb_object_agg(a.key, jsonb_build_object('version',a.version,
      'weights',nullif(a.scoring_weights,'{}'::jsonb)))
    from public.activity_profiles a where a.key = any(p_keys)
  ),'{}'::jsonb)) from public.scoring_policy s where singleton;
$$;
revoke all on function public.current_scoring_snapshot(text[]) from public, anon, authenticated, service_role, worker;

create function public.capture_scoring_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.snapshot := new.snapshot || jsonb_build_object('scoring', public.current_scoring_snapshot(
    array(select jsonb_array_elements_text(coalesce(new.snapshot->'activity_keys','[]'::jsonb)))
  ));
  return new;
end;
$$;
revoke all on function public.capture_scoring_snapshot() from public, anon, authenticated, service_role, worker;
create trigger capture_scoring_snapshot before insert on public.job_config_history
  for each row execute function public.capture_scoring_snapshot();

create table public.job_rescore_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  scoring_snapshot jsonb not null check (jsonb_typeof(scoring_snapshot) = 'object'),
  status text not null default 'pending' check (status in ('pending','done','failed')),
  scored_count integer not null default 0 check (scored_count >= 0),
  error_code text,
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint rescore_terminal check ((status = 'pending') = (finished_at is null))
);
create unique index job_rescore_one_pending on public.job_rescore_requests(job_id) where status='pending';
create index job_rescore_pending on public.job_rescore_requests(requested_at,id) where status='pending';
alter table public.job_rescore_requests enable row level security;
revoke all on public.job_rescore_requests from anon, authenticated, service_role, worker;
grant select on public.job_rescore_requests to authenticated, worker;
grant update (status, scored_count, error_code, finished_at) on public.job_rescore_requests to worker;
create policy rescore_read on public.job_rescore_requests for select to authenticated
  using (public.has_permission('jobs.view'));
create policy rescore_worker_read on public.job_rescore_requests for select to worker using (true);
create policy rescore_worker_update on public.job_rescore_requests for update to worker using (true) with check (true);

create function public.request_job_rescore(p_job_id uuid, p_confirmed boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_id uuid; v_snapshot jsonb;
begin
  if not public.has_permission('jobs.rescore') or not public.has_permission('jobs.view') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'rescore_confirmation_required' using errcode='22023';
  end if;
  select * into v_job from public.jobs where id=p_job_id for update;
  if not found then raise exception 'job_not_found' using errcode='P0002'; end if;
  if v_job.status not in ('completed','stopped') or exists (
    select 1 from public.opportunities where job_id=p_job_id and check_status='running'
  ) then raise exception 'rescore_requires_idle_finished_job' using errcode='55000'; end if;
  select id into v_id from public.job_rescore_requests where job_id=p_job_id and status='pending';
  if found then return v_id; end if; -- retries/double submissions reuse the captured policy
  -- Include historical activities on stored rows, even if subsequently deselected/disabled.
  v_snapshot := public.current_scoring_snapshot(array(
    select unnest(v_job.activity_keys) union
    select activity_key from public.opportunities where job_id=p_job_id and activity_key is not null union
    select c.evidence->>'activity_key' from public.opportunity_checks c
      join public.opportunities o on o.id=c.opportunity_id
      where o.job_id=p_job_id and c.check_key='activity_fit'
  ));
  insert into public.job_rescore_requests(job_id,requested_by,scoring_snapshot)
    values(p_job_id,auth.uid(),v_snapshot) returning id into v_id;
  insert into public.job_events(job_id,type,actor,config_version,payload)
    values(p_job_id,'rescore_requested',auth.uid(),v_job.config_version,
      jsonb_build_object('request_id',v_id,'scoring_config_version',v_snapshot->'policy'->'version'));
  return v_id;
end;
$$;
revoke all on function public.request_job_rescore(uuid,boolean) from public, anon, service_role, worker;
grant execute on function public.request_job_rescore(uuid,boolean) to authenticated;

-- Hold job/request locks through the caller's transaction. A crash rolls back
-- scores AND completion, leaving the request pending for another worker.
create function public.worker_next_rescore()
returns setof public.job_rescore_requests language sql security definer set search_path = '' as $$
  select r.* from public.job_rescore_requests r join public.jobs j on j.id=r.job_id
  where r.status='pending' and j.status in ('completed','stopped')
    and not exists(select 1 from public.opportunities o where o.job_id=j.id and o.check_status='running')
  order by r.requested_at,r.id limit 1 for update of j,r skip locked;
$$;
revoke all on function public.worker_next_rescore() from public, anon, authenticated, service_role;
grant execute on function public.worker_next_rescore() to worker;

create function public.worker_save_opportunity_score(
  p_id uuid,p_worker text,p_attempt integer,p_config_version integer,
  p_score numeric,p_tier public.opportunity_tier,p_breakdown jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.opportunities o where o.id=p_id and o.check_status='running'
    and o.locked_by=p_worker and o.attempts=p_attempt and o.config_version=p_config_version
    and o.lease_expires_at>clock_timestamp() and o.queue_group is distinct from 'auto_filtered'
    and o.duplicate_of is null for update;
  if not found then return false; end if;
  if p_score is null or p_tier is null or p_breakdown is null
    or (p_breakdown->>'config_version')::integer is distinct from p_config_version
    or not exists(select 1 from public.opportunity_checks where opportunity_id=p_id)
    or exists(select 1 from public.opportunity_checks where opportunity_id=p_id and config_version<>p_config_version)
  then raise exception 'score_requires_matching_checks' using errcode='22023'; end if;
  update public.opportunities set score=p_score,tier=p_tier,score_breakdown=p_breakdown where id=p_id;
  return true;
end;
$$;
revoke all on function public.worker_save_opportunity_score(uuid,text,integer,integer,numeric,public.opportunity_tier,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_save_opportunity_score(uuid,text,integer,integer,numeric,public.opportunity_tier,jsonb) to worker;
