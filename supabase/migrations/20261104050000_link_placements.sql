-- Manual outreach records and fenced, repeatable live-link verification.
-- Rollback: export placement history, then drop the functions and tables; no existing
-- opportunity or review rows are changed by this migration.
create table public.link_placements (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references public.opportunities(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  outreach_status text not null default 'not_contacted'
    check (outreach_status in ('not_contacted','contacted','negotiating','live','closed')),
  target_url text,
  source_url text,
  placed_at date,
  verification_status text not null default 'not_submitted'
    check (verification_status in ('not_submitted','pending','verified','unverified','unknown')),
  link_rel text[] not null default '{}',
  final_url text,
  first_seen_at timestamptz,
  last_checked_at timestamptz,
  failure_reason text,
  next_check_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  row_version bigint not null default 0 check (row_version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (outreach_status <> 'live' or
    (target_url is not null and source_url is not null and placed_at is not null)),
  check (target_url is null or char_length(target_url) <= 2048),
  check (source_url is null or char_length(source_url) <= 2048),
  check ((locked_by is null) = (lease_expires_at is null))
);
create index link_placements_due_idx on public.link_placements(next_check_at)
  where outreach_status='live';
create index link_placements_job_idx on public.link_placements(job_id,verification_status);

create table public.link_placement_events (
  id bigint generated always as identity primary key,
  placement_id uuid not null references public.link_placements(id) on delete cascade,
  kind text not null check (kind in ('manual','verification')),
  actor text not null,
  outreach_status text not null,
  verification_status text not null,
  reason text,
  at timestamptz not null default clock_timestamp()
);
create index link_placement_events_placement_idx
  on public.link_placement_events(placement_id,at desc,id desc);

revoke all on public.link_placements,public.link_placement_events
  from public,anon,authenticated,service_role,worker;
grant select on public.link_placements,public.link_placement_events to authenticated;
alter table public.link_placements enable row level security;
alter table public.link_placement_events enable row level security;
create policy link_placements_view on public.link_placements for select to authenticated
  using (public.has_permission('results.view'));
create policy link_placement_events_view on public.link_placement_events for select to authenticated
  using (public.has_permission('results.view'));

create function public.save_link_placement(
  p_opportunity_id uuid,p_status text,p_target_url text,p_source_url text,
  p_placed_at date,p_version bigint
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_opp public.opportunities;
  v_existing public.link_placements;
  v_client_domain text;
  v_target_host text;
  v_id uuid;
  v_target text := nullif(btrim(p_target_url),'');
  v_source text := nullif(btrim(p_source_url),'');
begin
  if not public.has_permission('results.view') or not public.has_permission('results.review') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_status is null or p_status not in
    ('not_contacted','contacted','negotiating','live','closed')
    or p_version is null or p_version < 0
    or char_length(coalesce(v_target,'')) > 2048
    or char_length(coalesce(v_source,'')) > 2048
    or (v_target is not null and v_target !~ '^https://[a-zA-Z0-9.-]+(/|$)')
    or (v_source is not null and v_source !~ '^https?://[a-zA-Z0-9.-]+(/|$)')
    or (p_status='live' and (v_target is null or v_source is null or p_placed_at is null))
  then raise exception 'invalid_placement' using errcode='22023'; end if;
  select o.* into v_opp from public.opportunities o
    where o.id=p_opportunity_id and o.duplicate_of is null for update;
  if not found then return 'missing'; end if;
  if v_opp.review_status not in ('approved','used') then return 'not_approved'; end if;
  select j.client_domain into v_client_domain from public.jobs j where j.id=v_opp.job_id;
  if v_target is not null then
    v_target_host := lower(substring(v_target from '^https://([^/]+)'));
    if v_target_host is distinct from v_client_domain
      and v_target_host not like '%.' || v_client_domain then
      raise exception 'target_not_client_domain' using errcode='22023';
    end if;
  end if;
  select * into v_existing from public.link_placements
    where opportunity_id=p_opportunity_id for update;
  if found then
    if v_existing.row_version <> p_version then return 'stale'; end if;
    update public.link_placements set outreach_status=p_status,
      target_url=v_target,source_url=v_source,placed_at=p_placed_at,
      verification_status=case when p_status='live' then 'pending' else 'not_submitted' end,
      link_rel='{}',final_url=null,failure_reason=null,
      next_check_at=case when p_status='live' then clock_timestamp() else null end,
      locked_by=null,lease_expires_at=null,attempts=0,
      row_version=row_version+1,updated_at=clock_timestamp()
    where id=v_existing.id returning id into v_id;
  else
    if p_version <> 0 then return 'stale'; end if;
    insert into public.link_placements(opportunity_id,job_id,outreach_status,
      target_url,source_url,placed_at,verification_status,next_check_at)
    values (p_opportunity_id,v_opp.job_id,p_status,v_target,v_source,p_placed_at,
      case when p_status='live' then 'pending' else 'not_submitted' end,
      case when p_status='live' then clock_timestamp() else null end)
    returning id into v_id;
  end if;
  insert into public.link_placement_events(placement_id,kind,actor,outreach_status,
    verification_status)
  values (v_id,'manual',auth.uid()::text,p_status,
    case when p_status='live' then 'pending' else 'not_submitted' end);
  return 'saved';
end;
$$;
revoke all on function public.save_link_placement(uuid,text,text,text,date,bigint)
  from public,anon,service_role,worker;
grant execute on function public.save_link_placement(uuid,text,text,text,date,bigint)
  to authenticated;

create function public.worker_claim_link_placement(p_worker text,p_lease_seconds integer)
returns setof public.link_placements language plpgsql security definer set search_path = '' as $$
begin
  if p_worker is null or length(btrim(p_worker)) not between 1 and 200
    or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_link_claim' using errcode='22023';
  end if;
  update public.link_placements set verification_status='unknown',
    failure_reason='verification_worker_failed',next_check_at=clock_timestamp()+interval '1 day',
    locked_by=null,lease_expires_at=null,attempts=0
  where outreach_status='live' and attempts=3 and lease_expires_at<clock_timestamp();
  return query
  with candidate as (
    select p.id from public.link_placements p where p.outreach_status='live'
      and p.next_check_at <= clock_timestamp() and p.attempts<3
      and (p.lease_expires_at is null or p.lease_expires_at<clock_timestamp())
    order by p.next_check_at,p.id limit 1 for update skip locked
  )
  update public.link_placements p set locked_by=p_worker,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempts=p.attempts+1
  from candidate c where p.id=c.id returning p.*;
end;
$$;
revoke all on function public.worker_claim_link_placement(text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.worker_claim_link_placement(text,integer) to worker;

create function public.worker_finish_link_placement(
  p_id uuid,p_worker text,p_attempt integer,p_status text,p_rel text[],
  p_final_url text,p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.link_placements; v_now timestamptz := clock_timestamp();
begin
  if p_status is null or p_status not in ('verified','unverified','unknown')
    or p_rel is null or p_rel <@ array['follow','nofollow','sponsored','ugc']::text[]
      is not true
    or char_length(coalesce(p_final_url,'')) > 2048
    or char_length(coalesce(p_reason,'')) > 200 then
    raise exception 'invalid_link_verification' using errcode='22023';
  end if;
  select * into v_row from public.link_placements where id=p_id for update;
  if not found or v_row.outreach_status<>'live' or v_row.locked_by is distinct from p_worker
    or v_row.attempts<>p_attempt or v_row.lease_expires_at<=v_now then return false; end if;
  update public.link_placements set verification_status=p_status,link_rel=p_rel,
    final_url=p_final_url,first_seen_at=case when p_status='verified'
      then coalesce(first_seen_at,v_now) else first_seen_at end,
    last_checked_at=v_now,failure_reason=p_reason,
    next_check_at=v_now+interval '1 day',locked_by=null,lease_expires_at=null,
    attempts=0,row_version=row_version+1,updated_at=v_now where id=p_id;
  insert into public.link_placement_events(placement_id,kind,actor,outreach_status,
    verification_status,reason)
  values (p_id,'verification',p_worker,'live',p_status,p_reason);
  return true;
end;
$$;
revoke all on function public.worker_finish_link_placement(uuid,text,integer,text,text[],text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.worker_finish_link_placement(uuid,text,integer,text,text[],text,text)
  to worker;
