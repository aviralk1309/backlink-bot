-- M3-S7: job runner functions: pick up queued jobs, detect drained jobs.
--
-- Design notes
--  * Stateless. No worker keeps per-job state in memory, so a crashed worker
--    never strands a job. Any worker may pick up or complete any job.
--  * `worker_pick_up_next_job` takes one queued job (FOR UPDATE SKIP LOCKED),
--    re-checks start readiness, then moves it to running, or to failed when
--    the config is bad (G2: unrecoverable config error). The failed job keeps
--    its reason in status_reason and in job_events (I3).
--  * `job_work_pending` is the single definition of "this job still has work".
--    Today it counts open opportunity rows only. CONTRACT for later MVPs:
--      - M4 must make it return 'import_pending' from the moment the job is
--        picked up until its CSV and seed import is finished. Otherwise a
--        sweep can complete a job between pick_up and the first insert.
--      - M8 adds 'queries_pending' (unfinished query rows) and the G2 rule
--        "every query row failed".
--    Both do `create or replace function public.job_work_pending`.
--  * `worker_complete_drained_jobs` completes `running` jobs only. A
--    `saturated` job stays saturated until someone resumes or stops it (G3).
--    Budget-reached keeps the job `running` until drained (G4): M8 makes
--    queries_pending false at that point, and this sweep does the rest.
--  * Pause and stop need no code here: neither status is `running`, so the
--    sweep never touches those jobs, and the claim function (M3-S6) already
--    refuses them.
--  * Functions that change job status are security definer and owned by the
--    migration owner. Only the `worker` role may execute them (I12).

-- Partial index: "any open work for this job" stays cheap while most rows are done.
create index opportunities_job_open_idx
  on public.opportunities (job_id)
  where check_status in ('pending', 'running');

-- ---------------------------------------------------------------------
-- job_work_pending: reasons a job is not finished. Empty array = drained.
-- ---------------------------------------------------------------------
create function public.job_work_pending(p_job_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v text[] := '{}';
begin
  if exists (
    select 1
    from public.opportunities o
    where o.job_id = p_job_id
      and o.check_status in ('pending', 'running')
  ) then
    v := array_append(v, 'checks_pending');
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- worker_pick_up_next_job: one queued job per call, none when queue is empty.
-- ---------------------------------------------------------------------
create function public.worker_pick_up_next_job()
returns table (job_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_problems text[];
begin
  select j.id
    into v_id
    from public.jobs j
   where j.status = 'queued'
   order by j.created_at, j.id
   limit 1
     for update skip locked;

  if v_id is null then
    return;
  end if;

  v_problems := public.job_start_problems(v_id);
  if cardinality(v_problems) > 0 then
    perform public.job_apply_transition(
      v_id, 'fail', 'bad_config:' || array_to_string(v_problems, ','), null
    );
    return query select v_id, 'failed'::text;
    return;
  end if;

  perform public.job_apply_transition(v_id, 'pick_up', null, null);
  return query select v_id, 'running'::text;
end;
$$;

-- ---------------------------------------------------------------------
-- worker_complete_drained_jobs: completes every running job with no work left.
-- Returns the ids it completed.
-- ---------------------------------------------------------------------
create function public.worker_complete_drained_jobs()
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_locked uuid;
begin
  for r in
    select j.id from public.jobs j where j.status = 'running' order by j.id
  loop
    -- Cheap check without a lock, then lock and check again: a pause, a stop
    -- or another worker's sweep may have moved the job in between.
    if cardinality(public.job_work_pending(r.id)) > 0 then
      continue;
    end if;

    select j.id
      into v_locked
      from public.jobs j
     where j.id = r.id and j.status = 'running'
       for update skip locked;

    if v_locked is null then
      continue;
    end if;

    if cardinality(public.job_work_pending(r.id)) = 0 then
      perform public.job_apply_transition(r.id, 'complete', 'drained', null);
      return next r.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges: worker only. Supabase default privileges hand new functions to
-- anon, authenticated and service_role, so revoke them all first.
-- job_start_problems is called by the definer functions above, but the worker
-- also needs it to be executable for its own readiness logging.
-- ---------------------------------------------------------------------
revoke all on function public.job_work_pending(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.worker_pick_up_next_job()
  from public, anon, authenticated, service_role;
revoke all on function public.worker_complete_drained_jobs()
  from public, anon, authenticated, service_role;

grant execute on function public.job_work_pending(uuid) to worker;
grant execute on function public.worker_pick_up_next_job() to worker;
grant execute on function public.worker_complete_drained_jobs() to worker;