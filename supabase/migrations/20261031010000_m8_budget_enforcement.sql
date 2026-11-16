-- M8-S5: serialize paid claims per job. S2 observed one credit for every
-- supported num=10/page request; later calls reserve the highest reported
-- per-call cost seen for that job.
create index if not exists job_queries_done_credit_idx on public.job_queries
  (job_id, credits_used desc nulls last) where status = 'done';

create or replace function public.claim_budgeted_query(
  p_worker_id text, p_lease_seconds integer default 120, p_max_attempts integer default 3)
returns setof public.job_queries
language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
  v_inflight integer;
  v_reservation integer;
  v_claim public.job_queries;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'invalid_worker_id' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_lease_seconds' using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'invalid_max_attempts' using errcode = '22023';
  end if;

  for v_job in
    select j.id, j.budget_credits, s.credits_used
    from public.jobs j join public.job_stats s on s.job_id = j.id
    where j.status = 'running' and j.budget_credits > s.credits_used
      and exists (select 1 from public.job_queries q
        where q.job_id = j.id and q.status = 'pending' and q.attempts < p_max_attempts)
    order by j.created_at, j.id
    for no key update of j skip locked
  loop
    select count(*) into v_inflight from public.job_queries q
      where q.job_id = v_job.id and q.status = 'running';
    select greatest(1, coalesce(max(q.credits_used), 0)) into v_reservation
      from public.job_queries q where q.job_id = v_job.id and q.status = 'done';
    if v_inflight >= 2
      or v_job.credits_used + (v_inflight + 1) * v_reservation > v_job.budget_credits then
      continue;
    end if;

    select q.* into v_claim from public.job_queries q
      where q.job_id = v_job.id and q.status = 'pending' and q.attempts < p_max_attempts
      order by q.priority, q.created_at, q.id
      limit 1 for update skip locked;
    if not found then
      continue;
    end if;
    update public.job_queries q
      set status = 'running', locked_by = p_worker_id,
          lease_expires_at = now() + make_interval(secs => p_lease_seconds),
          attempts = q.attempts + 1
      where q.id = v_claim.id returning q.* into v_claim;
    return next v_claim;
    return;
  end loop;
end;
$$;
revoke all on function public.claim_budgeted_query(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_budgeted_query(text, integer, integer) to worker;

-- Pending queries remain visible when spend exhausts the budget, but do not
-- keep a job Running after the remaining checks and in-flight calls drain.
create or replace function public.job_work_pending(p_job_id uuid)
returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v text[] := '{}';
begin
  if exists (select 1 from public.opportunities o
    where o.job_id = p_job_id and o.check_status in ('pending','running')) then
    v := array_append(v, 'checks_pending');
  end if;
  if exists (select 1 from public.job_queries q
    where q.job_id = p_job_id and q.status = 'running')
    or (exists (select 1 from public.job_queries q
      where q.job_id = p_job_id and q.status = 'pending')
      and exists (select 1 from public.jobs j join public.job_stats s on s.job_id = j.id
        where j.id = p_job_id and s.credits_used + greatest(1, coalesce(
          (select max(q.credits_used) from public.job_queries q
            where q.job_id = j.id and q.status = 'done'), 0)) <= j.budget_credits)) then
    v := array_append(v, 'queries_pending');
  end if;
  return v;
end;
$$;

create or replace function public.worker_complete_drained_jobs()
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_locked uuid;
  v_reason text;
begin
  for r in select j.id from public.jobs j where j.status = 'running' order by j.id loop
    if cardinality(public.job_work_pending(r.id)) > 0 then continue; end if;

    select j.id into v_locked from public.jobs j
      where j.id = r.id and j.status = 'running' for update skip locked;
    if v_locked is null or cardinality(public.job_work_pending(r.id)) > 0 then
      continue;
    end if;

    if exists (select 1 from public.job_queries q where q.job_id = r.id)
      and not exists (select 1 from public.job_queries q
        where q.job_id = r.id and q.status <> 'failed') then
      perform public.job_apply_transition(r.id, 'fail', 'all_queries_failed', null);
    else
      select case when j.budget_credits > 0 and (s.credits_used >= j.budget_credits
        or (exists (select 1 from public.job_queries q
          where q.job_id = j.id and q.status = 'pending')
          and s.credits_used + greatest(1, coalesce(
            (select max(q.credits_used) from public.job_queries q
              where q.job_id = j.id and q.status = 'done'), 0)) > j.budget_credits))
        then 'budget_reached' else 'drained' end into v_reason
      from public.jobs j join public.job_stats s on s.job_id = j.id where j.id = r.id;
      perform public.job_apply_transition(r.id, 'complete', v_reason, null);
      return next r.id;
    end if;
  end loop;
end;
$$;
