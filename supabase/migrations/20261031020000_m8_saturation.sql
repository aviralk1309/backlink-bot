-- M8-S6: a sliding window of completed Google queries pauses low-yield jobs.
alter table public.job_stats
  add column saturation_recheck_after integer not null default 0
    check (saturation_recheck_after >= 0);
create index job_queries_done_window_idx on public.job_queries
  (job_id, completed_at desc, id desc) where status = 'done';

-- Resume from Saturated waits for N additional successful queries before
-- another automatic pause. A normal Pause/Resume keeps the existing window.
create function public.jobs_reset_saturation_window()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'saturated' and new.status = 'running' then
    update public.job_stats s
      set saturation_recheck_after = s.queries_done + new.saturation_n
      where s.job_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.jobs_reset_saturation_window()
  from public, anon, authenticated, service_role, worker;
create trigger jobs_reset_saturation_window
  after update of status on public.jobs for each row
  execute function public.jobs_reset_saturation_window();

create function public.evaluate_job_saturation(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
  v_done integer;
  v_recheck_after integer;
  v_reservation integer;
  v_inflight integer;
  v_count integer;
  v_new_domains integer;
begin
  select * into v_job from public.jobs j
    where j.id = p_job_id and j.status = 'running' for update;
  if not found or v_job.saturation_x = 0 then return false; end if;

  select s.queries_done, s.saturation_recheck_after into v_done, v_recheck_after
    from public.job_stats s where s.job_id = p_job_id;
  if v_done < greatest(v_job.saturation_n, v_recheck_after) then return false; end if;

  -- Saturation is an auto-pause only while another affordable query can run.
  if not exists (select 1 from public.job_queries q
      where q.job_id = p_job_id and q.status = 'pending') then return false; end if;
  select count(*) into v_inflight from public.job_queries q
    where q.job_id = p_job_id and q.status = 'running';
  select greatest(1, coalesce(max(q.credits_used), 0)) into v_reservation
    from public.job_queries q where q.job_id = p_job_id and q.status = 'done';
  if v_inflight >= 2 or v_job.budget_credits <
      (select s.credits_used from public.job_stats s where s.job_id = p_job_id)
        + (v_inflight + 1) * v_reservation then return false; end if;

  select count(*), coalesce(sum(t.new_unique_domains), 0) into v_count, v_new_domains
    from (select q.new_unique_domains from public.job_queries q
      where q.job_id = p_job_id and q.status = 'done'
      order by q.completed_at desc nulls last, q.id desc
      limit v_job.saturation_n) t;
  if v_count < v_job.saturation_n or v_new_domains >= v_job.saturation_x then
    return false;
  end if;

  perform public.job_apply_transition(p_job_id, 'saturate', 'low_new_domain_yield', null);
  return true;
end;
$$;
revoke all on function public.evaluate_job_saturation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.evaluate_job_saturation(uuid) to worker;

-- The claim boundary closes the commit-to-evaluation race between workers.
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
    if public.evaluate_job_saturation(v_job.id) then continue; end if;

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
    if not found then continue; end if;
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
