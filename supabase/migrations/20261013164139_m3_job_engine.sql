-- M3-S6: job engine for opportunity checks: claim, lease extension, release, reap.
--
-- Design notes
--  * Claim uses FOR UPDATE SKIP LOCKED (ADR 0002). Two workers never get the
--    same row.
--  * Claimable jobs are `running` and `saturated` (G4): saturation stops new
--    queries only, so pending checks must drain. `paused` and `stopped` jobs
--    are never claimed. Budget-reached keeps the job `running` until the
--    runner (M3-S7) sees no pending work, so it needs no rule here. The query
--    claim in M8 will use a stricter rule (`running` only).
--  * `attempts` is incremented on claim, not in the reaper. A worker crash
--    therefore always counts as an attempt, and the reaper stays simple.
--    A graceful release gives the attempt back.
--  * Order is `priority, created_at, id`: gap rows before seed rows before
--    search rows (I6). It matches opportunities_claim_idx. There is no
--    per-job fairness: a job with older rows runs first within a priority.
--  * Functions run as the caller (security invoker). Only the `worker` role
--    may execute them. It already has the table grants it needs.
--  * Callers that finish a row must update it with
--    `where id = :id and locked_by = :worker_id and check_status = 'running'`.
--    If the reaper took the row back, that update touches zero rows and the
--    worker drops its result.
--  * Rows of a stopped job that are still pending stay pending. Nothing is
--    deleted (I3).
--  * Counters for rows that end `failed` here (unchecked_count) are handled
--    in M3-S8.

-- ---------------------------------------------------------------------
-- claim_opportunity_checks
-- ---------------------------------------------------------------------
create function public.claim_opportunity_checks(
  p_worker_id text,
  p_batch integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  id uuid,
  job_id uuid,
  original_url text,
  normalized_url text,
  host text,
  domain text,
  activity_key text,
  priority smallint,
  config_version integer,
  attempts integer,
  lease_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_worker_id is null or length(btrim(p_worker_id)) = 0 then
    raise exception 'invalid_worker_id';
  end if;
  if p_batch not between 1 and 100 then
    raise exception 'invalid_batch';
  end if;
  if p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_lease_seconds';
  end if;

  return query
  with picked as (
    select o.id
    from public.opportunities o
    where o.check_status = 'pending'
      and exists (
        select 1
        from public.jobs j
        where j.id = o.job_id
          and j.status in ('running', 'saturated')
      )
    order by o.priority, o.created_at, o.id
    limit p_batch
    for update of o skip locked
  )
  update public.opportunities o
     set check_status = 'running',
         locked_by = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning
    o.id, o.job_id, o.original_url, o.normalized_url, o.host, o.domain,
    o.activity_key, o.priority, o.config_version, o.attempts, o.lease_expires_at;
end;
$$;

-- ---------------------------------------------------------------------
-- extend_opportunity_leases
-- Returns the ids this worker still holds. A missing id means the claim was
-- lost (reaped and maybe re-claimed): the worker must drop that row's result.
-- ---------------------------------------------------------------------
create function public.extend_opportunity_leases(
  p_worker_id text,
  p_ids uuid[],
  p_lease_seconds integer default 120
)
returns setof uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_lease_seconds';
  end if;

  return query
  with held as (
    select o.id
    from public.opportunities o
    where o.id = any (p_ids)
      and o.check_status = 'running'
      and o.locked_by = p_worker_id
    order by o.id
    for update of o
  )
  update public.opportunities o
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from held
   where o.id = held.id
  returning o.id;
end;
$$;

-- ---------------------------------------------------------------------
-- release_opportunity_claims
-- Graceful shutdown: hand back every row this worker holds, and give the
-- attempt back. Returns the number of rows released.
-- ---------------------------------------------------------------------
create function public.release_opportunity_claims(p_worker_id text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with held as (
    select o.id
    from public.opportunities o
    where o.check_status = 'running'
      and o.locked_by = p_worker_id
    order by o.id
    for update of o
  )
  update public.opportunities o
     set check_status = 'pending',
         locked_by = null,
         lease_expires_at = null,
         attempts = greatest(o.attempts - 1, 0)
    from held
   where o.id = held.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- reap_expired_leases
-- Rows left `running` by a crashed or stalled worker go back to `pending`.
-- A row that already used p_max_attempts claims becomes `failed` with a
-- reason (I3). Works on every job status, so rows of paused jobs are not
-- stranded. Handles up to p_limit rows per call; call it on every tick.
-- ---------------------------------------------------------------------
create function public.reap_expired_leases(
  p_max_attempts integer default 3,
  p_limit integer default 500
)
returns table (requeued integer, failed integer)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_max_attempts < 1 then
    raise exception 'invalid_max_attempts';
  end if;
  if p_limit not between 1 and 5000 then
    raise exception 'invalid_limit';
  end if;

  return query
  with expired as (
    select o.id
    from public.opportunities o
    where o.check_status = 'running'
      and o.lease_expires_at < now()
    order by o.lease_expires_at, o.id
    limit p_limit
    for update of o skip locked
  ),
  moved as (
    update public.opportunities o
       set check_status = case
             when o.attempts >= p_max_attempts then 'failed'::public.opportunity_check_status
             else 'pending'::public.opportunity_check_status
           end,
           check_reason = case
             when o.attempts >= p_max_attempts then 'max_attempts_exceeded'
             else o.check_reason
           end,
           locked_by = null,
           lease_expires_at = null
      from expired
     where o.id = expired.id
    returning o.check_status
  )
  select
    (count(*) filter (where m.check_status = 'pending'))::integer,
    (count(*) filter (where m.check_status = 'failed'))::integer
  from moved m;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges: only the worker role. Supabase default privileges grant new
-- functions to anon, authenticated and service_role, so revoke them all.
-- ---------------------------------------------------------------------
revoke all on function public.claim_opportunity_checks(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.extend_opportunity_leases(text, uuid[], integer)
  from public, anon, authenticated, service_role;
revoke all on function public.release_opportunity_claims(text)
  from public, anon, authenticated, service_role;
revoke all on function public.reap_expired_leases(integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_opportunity_checks(text, integer, integer) to worker;
grant execute on function public.extend_opportunity_leases(text, uuid[], integer) to worker;
grant execute on function public.release_opportunity_claims(text) to worker;
grant execute on function public.reap_expired_leases(integer, integer) to worker;