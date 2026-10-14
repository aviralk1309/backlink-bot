-- M3-S8: live counters. Keeps job_stats.unchecked_count exact (G12) and adds
-- the entry point M8 will use for query and credit counters.
--
-- Design notes
--  * `opportunity_counts_unchecked` is the ONE definition of "unchecked". The
--    trigger and `job_stats_recount` both call it, so they cannot drift.
--    A row counts as unchecked when it is canonical (not merged into another
--    row), not auto-filtered, and either its check ended `skipped` or `failed`
--    (could not check, domain cap, retries used up) or its tier is Unchecked.
--      - Merged duplicates are skipped by design and are not "could not check".
--      - Auto-filtered rows were removed by a rule, not left unchecked (I3, I4).
--  * The trigger is a DEFERRED constraint trigger: it updates job_stats once per
--    changed row at COMMIT, after every other lock the transaction took.
--    record_discovery documents the lock order opportunities, sources,
--    job_domains, job_stats. An immediate trigger would take the job_stats lock
--    early (e.g. when a blocklisted row is inserted) and could deadlock with
--    another worker that holds a job_domains row. Deferred keeps job_stats last.
--    Cost: counters lag until commit, which they always did for readers.
--    Test note: pgTAP runs in one transaction that never commits, so tests
--    must run `set constraints all immediate`.
--  * Deltas are computed per event from OLD and NEW, so they add up correctly
--    however many times a row changes inside one transaction.
--  * `job_stats_add` is a plain increment for M8. It is not a replacement for
--    job_stats_recount-style repair: nothing here rewrites counters.
--  * unique_opportunities and duplicates_skipped stay with record_discovery and
--    merge_opportunity_after_fetch (M3-S4). Not touched here.

-- ---------------------------------------------------------------------
-- The definition
-- ---------------------------------------------------------------------
create function public.opportunity_counts_unchecked(
  p_duplicate_of uuid,
  p_queue_group public.opportunity_queue_group,
  p_check_status public.opportunity_check_status,
  p_tier public.opportunity_tier
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_duplicate_of is null
    and p_queue_group is distinct from 'auto_filtered'
    and (p_check_status in ('skipped', 'failed') or p_tier = 'unchecked'),
    false
  )
$$;

-- ---------------------------------------------------------------------
-- Recount from raw rows. For tests and admin health checks, never for repair.
-- ---------------------------------------------------------------------
create function public.job_stats_recount(p_job_id uuid)
returns table (unique_opportunities integer, unchecked_count integer)
language sql
stable
set search_path = ''
as $$
  select
    (count(*) filter (where o.duplicate_of is null))::integer,
    (count(*) filter (
      where public.opportunity_counts_unchecked(
        o.duplicate_of, o.queue_group, o.check_status, o.tier)
    ))::integer
  from public.opportunities o
  where o.job_id = p_job_id
$$;

-- ---------------------------------------------------------------------
-- Trigger: unchecked_count follows opportunities
-- ---------------------------------------------------------------------
create function public.opportunities_track_unchecked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean := false;
  v_new boolean := false;
  v_delta integer;
  v_job uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := public.opportunity_counts_unchecked(
      old.duplicate_of, old.queue_group, old.check_status, old.tier);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := public.opportunity_counts_unchecked(
      new.duplicate_of, new.queue_group, new.check_status, new.tier);
  end if;

  v_delta := v_new::integer - v_old::integer;
  if v_delta <> 0 then
    v_job := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
    -- No error when the row is gone: a deleted job cascades to its stats row.
    update public.job_stats s
       set unchecked_count = s.unchecked_count + v_delta
     where s.job_id = v_job;
  end if;
  return null;
end;
$$;

create constraint trigger opportunities_track_unchecked
  after insert or update of check_status, tier, queue_group, duplicate_of or delete
  on public.opportunities
  deferrable initially deferred
  for each row execute function public.opportunities_track_unchecked();

-- Back-fill: rows written before this trigger existed.
update public.job_stats s
   set unchecked_count = c.n
  from (
    select o.job_id, count(*)::integer as n
    from public.opportunities o
    where public.opportunity_counts_unchecked(
      o.duplicate_of, o.queue_group, o.check_status, o.tier)
    group by o.job_id
  ) c
 where c.job_id = s.job_id;

-- ---------------------------------------------------------------------
-- Entry point for M8: query and credit counters. Call it in the same
-- transaction that updates the query row.
-- ---------------------------------------------------------------------
create function public.job_stats_add(
  p_job_id uuid,
  p_credits integer default 0,
  p_queries_done integer default 0,
  p_queries_total integer default 0
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_credits < 0 or p_queries_done < 0 or p_queries_total < 0 then
    raise exception 'invalid_delta' using errcode = '22023';
  end if;

  update public.job_stats s
     set credits_used = s.credits_used + p_credits,
         queries_done = s.queries_done + p_queries_done,
         queries_total = s.queries_total + p_queries_total
   where s.job_id = p_job_id;
  if not found then
    raise exception 'job_stats row missing for job %', p_job_id using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges: worker only (I12). Supabase hands new functions to anon,
-- authenticated and service_role, so revoke them by name.
-- ---------------------------------------------------------------------
revoke all on function public.opportunity_counts_unchecked(
    uuid, public.opportunity_queue_group, public.opportunity_check_status, public.opportunity_tier)
  from public, anon, authenticated, service_role;
revoke all on function public.job_stats_recount(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.opportunities_track_unchecked()
  from public, anon, authenticated, service_role;
revoke all on function public.job_stats_add(uuid, integer, integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.opportunity_counts_unchecked(
    uuid, public.opportunity_queue_group, public.opportunity_check_status, public.opportunity_tier)
  to worker;
grant execute on function public.job_stats_recount(uuid) to worker;
grant execute on function public.job_stats_add(uuid, integer, integer, integer) to worker;