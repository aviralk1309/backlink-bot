-- M3-S4: record a discovery, and merge duplicates found after a fetch.
--
-- Design notes
--  * The worker normalizes (apps/worker/src/worker/urls) and passes the result.
--    These functions never compute a URL or a domain.
--  * SECURITY INVOKER on purpose. They run with the caller's rights, so the
--    `worker` role's grants and RLS policies are the real limit. Only `worker`
--    may execute them. Nothing here is callable from a browser (I12).
--  * One round trip, one transaction per discovery. The row, its "found by"
--    record, the job-domain record and the counters commit together or not at all.
--  * Dedup is `INSERT ... ON CONFLICT DO NOTHING` on (job_id, normalized_url) (I7).
--    Two workers that find the same URL at the same moment: one inserts, the
--    other waits for it, then adds its own source. No loser is dropped, no error.
--  * Replaying the same discovery (same job, URL, source type, source ref) is a
--    no-op. A retried query never double counts.
--  * Counter meaning (job_stats):
--      unique_opportunities = rows of the job with duplicate_of is null
--      duplicates_skipped   = discoveries that did not create a unique row:
--                             +1 for each new source added to an existing row,
--                             +1 for each row merged into another after a fetch
--  * Lock order is always: opportunities rows, then sources, then job_domains,
--    then job_stats. job_stats is last so the hot counter row is held briefly.
--  * No status check on the job. A Stop or Pause can arrive while a request is in
--    flight, and a late result is still stored, never dropped (I3).
--  * Not here: blocklist and previously-spam flags (M3-S5), claim and lease
--    (M3-S6), scoring and overlap counts (M5).

-- ---------------------------------------------------------------------
-- record_discovery
-- ---------------------------------------------------------------------
create function public.record_discovery(
  p_job_id uuid,
  p_original_url text,
  p_normalized_url text,
  p_host text,
  p_domain text,
  p_source_type text,
  p_source_ref text,
  p_extras jsonb default '{}'::jsonb
)
returns table (
  opp_id uuid,        -- the canonical row that now holds this discovery
  created boolean,    -- a new unique opportunity was inserted
  source_added boolean, -- a new "found by" record was inserted
  domain_added boolean  -- first time this registered domain is seen in the job (G11)
)
language plpgsql
set search_path = ''
as $$
declare
  v_config_version integer;
  v_priority smallint;
  v_id uuid;
  v_created boolean := false;
  v_source_added boolean := false;
  v_domain_added boolean := false;
begin
  p_extras := coalesce(p_extras, '{}'::jsonb);
  if jsonb_typeof(p_extras) <> 'object' then
    raise exception 'extras must be a JSON object' using errcode = '22023';
  end if;

  v_priority := case p_source_type
    when 'competitor_csv' then 0
    when 'seed_list' then 1
    when 'google' then 2
  end;
  if v_priority is null then
    raise exception 'unknown source type: %', p_source_type using errcode = '22023';
  end if;

  select j.config_version into v_config_version
  from public.jobs j
  where j.id = p_job_id;
  if not found then
    raise exception 'job not found: %', p_job_id using errcode = 'P0002';
  end if;

  insert into public.opportunities
    (job_id, original_url, normalized_url, host, domain,
     first_source_type, priority, config_version, extras)
  values
    (p_job_id, p_original_url, p_normalized_url, p_host, p_domain,
     p_source_type, v_priority, v_config_version, p_extras)
  on conflict (job_id, normalized_url) do nothing
  returning id into v_id;

  v_created := v_id is not null;

  if v_created then
    insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values (v_id, p_source_type, p_source_ref);
    v_source_added := true;
  else
    -- Already stored. Follow a post-fetch merge to the canonical row, and lock
    -- that row before adding the source. If a merge is running on the row, the
    -- lock waits for it, then the `duplicate_of is null` test fails on the new
    -- version of the row and we resolve again. So a source is never left on a
    -- row that has just been merged away. Only one row lock is held at a time.
    loop
      select coalesce(o.duplicate_of, o.id) into v_id
      from public.opportunities o
      where o.job_id = p_job_id and o.normalized_url = p_normalized_url;

      if v_id is null then
        -- The job was deleted while we ran.
        raise exception 'opportunity disappeared for job %', p_job_id using errcode = 'P0002';
      end if;

      perform 1
      from public.opportunities o
      where o.id = v_id and o.duplicate_of is null
      for update;

      exit when found;
    end loop;

    insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values (v_id, p_source_type, p_source_ref)
    on conflict do nothing
    returning true into v_source_added;
    v_source_added := coalesce(v_source_added, false);

    if v_source_added then
      -- Existing keys win, new keys are added. Nothing is overwritten.
      update public.opportunities o
      set found_by_count = o.found_by_count + 1,
          priority = least(o.priority, v_priority),
          extras = p_extras || o.extras
      where o.id = v_id;
    end if;
  end if;

  insert into public.job_domains (job_id, registered_domain, first_source_type)
  values (p_job_id, p_domain, p_source_type)
  on conflict do nothing
  returning true into v_domain_added;
  v_domain_added := coalesce(v_domain_added, false);

  if v_created or v_source_added then
    update public.job_stats s
    set unique_opportunities = s.unique_opportunities + case when v_created then 1 else 0 end,
        duplicates_skipped = s.duplicates_skipped + case when v_created then 0 else 1 end
    where s.job_id = p_job_id;
    if not found then
      raise exception 'job_stats row missing for job %', p_job_id using errcode = 'P0002';
    end if;
  end if;

  return query select v_id, v_created, v_source_added, v_domain_added;
end;
$$;

-- ---------------------------------------------------------------------
-- merge_opportunity_after_fetch
--
-- Called by the worker after a fetch, when the final URL (after redirects, or the
-- canonical link) normalizes to something other than the stored URL.
--   * No row for the final URL in the job: nothing happens ('unchanged').
--     The stored normalized_url is never rewritten (I8, I7).
--   * A row exists: this row is marked a duplicate of it, its sources move to the
--     canonical row, and it becomes 'skipped' with a reason. Nothing is deleted (I3).
--   * Only rows still 'pending' or 'running' merge. Anything further along is left
--     alone ('not_mergeable').
--   * Merges never chain: the target is always a canonical row. If the final URL
--     is itself a merged row, its canonical row is the target.
-- After 'merged' the caller must stop processing this row.
-- ---------------------------------------------------------------------
create function public.merge_opportunity_after_fetch(
  p_opportunity_id uuid,
  p_final_normalized_url text
)
returns table (
  outcome text,        -- unchanged | merged | already_merged | not_mergeable
  canonical_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_job uuid;
  v_url text;
  v_b uuid;
  v_b_dup uuid;
  v_target uuid;
  v_a_dup uuid;
  v_a_status public.opportunity_check_status;
  v_a_priority smallint;
begin
  select o.job_id, o.normalized_url into v_job, v_url
  from public.opportunities o
  where o.id = p_opportunity_id;
  if not found then
    raise exception 'opportunity not found: %', p_opportunity_id using errcode = 'P0002';
  end if;

  if p_final_normalized_url is null or p_final_normalized_url = v_url then
    return query select 'unchanged'::text, p_opportunity_id;
    return;
  end if;

  select o.id, o.duplicate_of into v_b, v_b_dup
  from public.opportunities o
  where o.job_id = v_job and o.normalized_url = p_final_normalized_url;
  if v_b is null then
    return query select 'unchanged'::text, p_opportunity_id;
    return;
  end if;

  -- Lock this row, the final-URL row, and its canonical row, in id order.
  perform 1
  from public.opportunities o
  where o.id in (p_opportunity_id, v_b, coalesce(v_b_dup, v_b))
  order by o.id
  for update;

  -- Re-read under the lock.
  select o.duplicate_of, o.check_status, o.priority
    into v_a_dup, v_a_status, v_a_priority
  from public.opportunities o
  where o.id = p_opportunity_id;

  if v_a_dup is not null then
    return query select 'already_merged'::text, v_a_dup;
    return;
  end if;
  if v_a_status not in ('pending', 'running') then
    return query select 'not_mergeable'::text, p_opportunity_id;
    return;
  end if;

  select coalesce(o.duplicate_of, o.id) into v_target
  from public.opportunities o
  where o.id = v_b;

  if v_target is distinct from coalesce(v_b_dup, v_b) then
    -- The final-URL row was merged while we waited for the lock. Caller retries.
    raise exception 'merge target changed, retry' using errcode = '40001';
  end if;

  if v_target = p_opportunity_id then
    -- The final-URL row was already merged into this one. This row is canonical.
    return query select 'unchanged'::text, p_opportunity_id;
    return;
  end if;

  insert into public.opportunity_sources (opportunity_id, source_type, source_ref, found_at)
  select v_target, s.source_type, s.source_ref, s.found_at
  from public.opportunity_sources s
  where s.opportunity_id = p_opportunity_id
  on conflict do nothing;

  -- Rows merged into this one earlier now point at the new canonical row.
  update public.opportunities o
  set duplicate_of = v_target
  where o.duplicate_of = p_opportunity_id;

  update public.opportunities o
  set found_by_count = (
        select count(*) from public.opportunity_sources s where s.opportunity_id = o.id
      ),
      priority = least(o.priority, v_a_priority)
  where o.id = v_target;

  update public.opportunities o
  set duplicate_of = v_target,
      check_status = 'skipped',
      check_reason = 'duplicate_of_final_url',
      locked_by = null,
      lease_expires_at = null
  where o.id = p_opportunity_id;

  update public.job_stats s
  set unique_opportunities = s.unique_opportunities - 1,
      duplicates_skipped = s.duplicates_skipped + 1
  where s.job_id = v_job;
  if not found then
    raise exception 'job_stats row missing for job %', v_job using errcode = 'P0002';
  end if;

  return query select 'merged'::text, v_target;
end;
$$;

-- ---------------------------------------------------------------------
-- Execute rights: the worker only. Supabase default privileges grant new
-- functions to anon, authenticated and service_role, so revoke them by name.
-- ---------------------------------------------------------------------
revoke all on function public.record_discovery(uuid, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.merge_opportunity_after_fetch(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.record_discovery(uuid, text, text, text, text, text, text, jsonb)
  to worker;
grant execute on function public.merge_opportunity_after_fetch(uuid, text)
  to worker;