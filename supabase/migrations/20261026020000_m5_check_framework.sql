-- Latest complete raw-check snapshot. Full scoring/claim completion belongs to S9.
create table public.opportunity_checks (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  check_key text not null check (check_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text not null check (status in ('pass', 'fail', 'could_not_check')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  detail text not null default '' check (char_length(detail) <= 2000),
  evidence jsonb not null default '{}' check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384),
  config_version integer not null check (config_version > 0),
  checked_at timestamptz not null default now(),
  primary key (opportunity_id, check_key)
);
alter table public.opportunity_checks enable row level security;
revoke all on public.opportunity_checks from public, anon, authenticated, service_role, worker;
grant select on public.opportunity_checks to authenticated, worker;
create policy opportunity_checks_read on public.opportunity_checks for select to authenticated
  using (public.has_permission('results.view') and exists (
    select 1 from public.opportunities o where o.id = opportunity_id));
create policy opportunity_checks_worker_read on public.opportunity_checks for select to worker
  using (true);

create function public.worker_save_opportunity_checks(
  p_id uuid, p_worker text, p_attempt integer, p_config_version integer, p_results jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_opportunity public.opportunities;
  v_time timestamptz;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_check_results' using errcode = '22023';
  end if;
  if jsonb_array_length(p_results) not between 1 and 64 then
    raise exception 'invalid_check_results' using errcode = '22023';
  end if;
  select * into v_opportunity from public.opportunities where id = p_id for update;
  if not found then return false; end if;
  v_time := clock_timestamp();
  if v_opportunity.check_status <> 'running'
     or v_opportunity.locked_by is distinct from p_worker
     or v_opportunity.attempts is distinct from p_attempt
     or v_opportunity.config_version is distinct from p_config_version
     or v_opportunity.lease_expires_at <= v_time then
    return false;
  end if;
  -- Replacement removes obsolete downstream rows after an early stop on rerun.
  -- Any invalid row aborts the whole statement and preserves the prior snapshot.
  delete from public.opportunity_checks where opportunity_id = p_id;
  insert into public.opportunity_checks
    (opportunity_id, check_key, status, reason_code, detail, evidence, config_version, checked_at)
    select p_id, r.check_key, r.status, r.reason_code, r.detail, r.evidence, p_config_version, v_time
    from jsonb_to_recordset(p_results) as r(
      check_key text, status text, reason_code text, detail text, evidence jsonb);
  return true;
end;
$$;
revoke all on function public.worker_save_opportunity_checks(uuid,text,integer,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_save_opportunity_checks(uuid,text,integer,integer,jsonb)
  to worker;
