-- M2-S3 + M2-S6: config versioning (A5) and the job lifecycle state machine.
--
-- DEFAULT-ASSUMED choices (change only with an ADR):
--  * `queued -> stopped` is allowed (not in the original table), so a job
--    waiting for a worker can be cancelled and then deleted.
--  * `queued -> failed` is allowed for the worker (bad config found at pick up).
--  * Start readiness (job_start_problems) treats a source as present when the
--    job has budget > 0, seed list URLs, or competitor domains. M4 replaces
--    this function to also count uploaded CSV files.
--  * Terminal states (stopped, completed, failed) have no way out.
--
-- Who may do what:
--  * Signed-in users call transition_job (start, pause, resume, stop).
--    Permission is checked inside: jobs.start for start, jobs.control for
--    the rest.
--  * Workers call worker_transition_job (pick_up, complete, saturate, fail).
--    Not executable by anon or authenticated, only by service_role and the
--    database owner (the worker connects directly, ADR 0003).
--  * Clients never write jobs.status or jobs.config_version (column grants
--    from the previous migration).

-- ---------------------------------------------------------------------
-- Extra lifecycle columns (not client-writable: not in any column grant)
-- ---------------------------------------------------------------------
alter table public.jobs
  add column status_reason text,
  add column started_at timestamptz,
  add column finished_at timestamptz;

-- ---------------------------------------------------------------------
-- Config snapshot: every column a user can edit, nothing lifecycle-related.
-- ---------------------------------------------------------------------
create function public.job_config_snapshot(j public.jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(j)
    - 'id' - 'job_type' - 'status' - 'status_reason' - 'config_version'
    - 'started_at' - 'finished_at' - 'created_by' - 'created_at' - 'updated_at'
$$;

-- ---------------------------------------------------------------------
-- A5: a Draft is edited freely. Once a job has left Draft, every real
-- config change creates a new config_version.
-- ---------------------------------------------------------------------
create function public.jobs_bump_config_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and public.job_config_snapshot(new) is distinct from public.job_config_snapshot(old)
  then
    new.config_version := old.config_version + 1;
  end if;
  return new;
end;
$$;

create trigger jobs_bump_config_version
  before update on public.jobs
  for each row execute function public.jobs_bump_config_version();

-- History and activity log. security definer: clients have no write grant
-- on job_config_history or job_events.
create function public.jobs_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_fields jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.job_events (job_id, type, payload, actor, config_version)
    values (
      new.id, 'created', jsonb_build_object('name', new.name),
      auth.uid(), new.config_version
    );
    return new;
  end if;

  v_old := public.job_config_snapshot(old);
  v_new := public.job_config_snapshot(new);
  if v_old is not distinct from v_new then
    return new; -- status-only change: the transition function logs it
  end if;

  -- Field names only, never values.
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
    into v_fields
    from jsonb_object_keys(v_new) as k
   where v_new -> k is distinct from v_old -> k;

  if new.config_version > old.config_version then
    insert into public.job_config_history (job_id, version, snapshot, changed_by)
    values (new.id, new.config_version, v_new, auth.uid());

    insert into public.job_events (job_id, type, payload, actor, config_version)
    values (
      new.id, 'config_changed',
      jsonb_build_object('fields', v_fields, 'from_version', old.config_version),
      auth.uid(), new.config_version
    );
  else
    insert into public.job_events (job_id, type, payload, actor, config_version)
    values (
      new.id, 'edited', jsonb_build_object('fields', v_fields),
      auth.uid(), new.config_version
    );
  end if;
  return new;
end;
$$;

create trigger jobs_log_changes
  after insert or update on public.jobs
  for each row execute function public.jobs_log_changes();

-- ---------------------------------------------------------------------
-- The transition table, as one pure function. Null means "not allowed".
-- ---------------------------------------------------------------------
create function public.job_transition_target(
  p_status public.job_status,
  p_action text
)
returns public.job_status
language sql
immutable
set search_path = ''
as $$
  select (case
    when p_action = 'start'    and p_status = 'draft'                              then 'queued'
    when p_action = 'pick_up'  and p_status = 'queued'                             then 'running'
    when p_action = 'pause'    and p_status = 'running'                            then 'paused'
    when p_action = 'resume'   and p_status in ('paused', 'saturated')             then 'running'
    when p_action = 'stop'     and p_status in ('queued', 'running', 'paused', 'saturated') then 'stopped'
    when p_action = 'complete' and p_status = 'running'                            then 'completed'
    when p_action = 'saturate' and p_status = 'running'                            then 'saturated'
    when p_action = 'fail'     and p_status in ('queued', 'running')               then 'failed'
  end)::public.job_status
$$;

-- ---------------------------------------------------------------------
-- Start readiness. Returns problem codes, empty array means ready.
-- Security invoker: the UI calls it to show a checklist before Start.
-- ---------------------------------------------------------------------
create function public.job_start_problems(p_job_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  j public.jobs;
  v text[] := '{}';
begin
  select * into j from public.jobs where id = p_job_id;
  if not found then
    raise exception 'job_not_found';
  end if;

  if coalesce(btrim(j.client_domain), '') = '' then
    v := array_append(v, 'missing_client_domain');
  end if;
  if coalesce(btrim(j.business_type), '') = '' then
    v := array_append(v, 'missing_business_type');
  end if;
  if j.country is null then
    v := array_append(v, 'missing_country');
  end if;
  if j.language is null then
    v := array_append(v, 'missing_language');
  end if;
  if cardinality(j.seed_keywords) = 0 then
    v := array_append(v, 'missing_seed_keywords');
  end if;

  if cardinality(j.activity_keys) = 0 then
    v := array_append(v, 'no_activity');
  else
    if exists (
      select 1 from unnest(j.activity_keys) as k
      where not exists (select 1 from public.activity_profiles a where a.key = k)
    ) then
      v := array_append(v, 'activity_unknown');
    end if;
    if exists (
      select 1
      from unnest(j.activity_keys) as k
      join public.activity_profiles a on a.key = k
      where not a.enabled
    ) then
      v := array_append(v, 'activity_disabled');
    end if;
  end if;

  if not (
    j.budget_credits > 0
    or cardinality(j.seed_list_urls) > 0
    or cardinality(j.competitor_domains) > 0
  ) then
    v := array_append(v, 'no_source');
  end if;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Internal: apply one transition under a row lock. Not callable by clients.
-- ---------------------------------------------------------------------
create function public.job_apply_transition(
  p_job_id uuid,
  p_action text,
  p_reason text,
  p_actor uuid
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  v_target public.job_status;
  v_problems text[];
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  v_target := public.job_transition_target(j.status, p_action);
  if v_target is null then
    raise exception 'invalid_transition: % from %', p_action, j.status;
  end if;

  if p_action = 'start' then
    v_problems := public.job_start_problems(j.id);
    if cardinality(v_problems) > 0 then
      raise exception 'job_not_ready:%', array_to_string(v_problems, ',');
    end if;
    -- Workers read config by version, so the first version needs a snapshot.
    insert into public.job_config_history (job_id, version, snapshot, changed_by)
    values (j.id, j.config_version, public.job_config_snapshot(j), p_actor)
    on conflict do nothing;
  end if;

  update public.jobs
     set status = v_target,
         status_reason = case
           when p_action in ('start', 'pick_up', 'pause', 'resume') then null
           else left(p_reason, 200)
         end,
         started_at = case
           when p_action = 'pick_up' then coalesce(started_at, now())
           else started_at
         end,
         finished_at = case
           when v_target in ('stopped', 'completed', 'failed') then now()
           else finished_at
         end
   where id = j.id;

  insert into public.job_events (job_id, type, payload, actor, config_version)
  values (
    j.id, 'status_changed',
    jsonb_strip_nulls(jsonb_build_object(
      'from', j.status, 'to', v_target, 'action', p_action,
      'reason', left(p_reason, 200)
    )),
    p_actor, j.config_version
  );

  return v_target;
end;
$$;

-- ---------------------------------------------------------------------
-- Public entry points
-- ---------------------------------------------------------------------
create function public.transition_job(
  p_job_id uuid,
  p_action text,
  p_reason text default null
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('start', 'pause', 'resume', 'stop') then
    raise exception 'invalid_action';
  end if;

  if not public.has_permission(
    case when p_action = 'start' then 'jobs.start' else 'jobs.control' end
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.job_apply_transition(p_job_id, p_action, p_reason, auth.uid());
end;
$$;

create function public.worker_transition_job(
  p_job_id uuid,
  p_action text,
  p_reason text default null
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('pick_up', 'complete', 'saturate', 'fail') then
    raise exception 'invalid_action';
  end if;
  return public.job_apply_transition(p_job_id, p_action, p_reason, null);
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on function public.job_config_snapshot(public.jobs) from public, anon;
revoke all on function public.job_transition_target(public.job_status, text) from public, anon;
revoke all on function public.job_start_problems(uuid) from public, anon;
revoke all on function public.job_apply_transition(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.transition_job(uuid, text, text) from public, anon;
revoke all on function public.worker_transition_job(uuid, text, text) from public, anon, authenticated;

grant execute on function public.job_config_snapshot(public.jobs) to authenticated;
grant execute on function public.job_transition_target(public.job_status, text) to authenticated;
grant execute on function public.job_start_problems(uuid) to authenticated;
grant execute on function public.transition_job(uuid, text, text) to authenticated;
grant execute on function public.worker_transition_job(uuid, text, text) to service_role;