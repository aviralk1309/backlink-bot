-- M3-S5: auto-filter blocklisted domains and flag previously-spam domains at discovery.
--
-- Design notes
--  * Replaces record_discovery from the S4 migration (same arguments, two more
--    output columns). Everything from S4 still holds; see that file.
--  * G9, decided once when the row is created and stored on the row (I8):
--      1. domain is on the global blocklist      -> auto_filtered, 'blocklisted'
--      2. domain is in the job's blocked_domains -> auto_filtered, 'job_blocked_domain'
--      3. domains.global_spam is set (a spam reject seen in another job):
--           job.skip_previously_spam_domains on  -> auto_filtered, 'previously_spam'
--           off                                  -> row stays pending, flags.previously_spam = true
--  * Auto-filtered rows are stored, never deleted (I3), are 'skipped' with the same
--    reason as check_reason, and are never claimed, so never fetched.
--  * They do not enter job_domains, so they never count as a "new unique domain"
--    for saturation (G11). They do count in unique_opportunities.
--  * Later blocklist changes do not touch rows that already exist. Their source
--    is still added when the URL is found again.
--  * Not here: the same check against the final URL after redirects (M5).

drop function public.record_discovery(uuid, text, text, text, text, text, text, jsonb);

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
  domain_added boolean, -- first time this registered domain is seen in the job (G11)
  filter_reason text,   -- set when the new row was auto-filtered (never fetched)
  previously_spam boolean -- the new row is flagged: domain was rejected as spam before (G9)
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
  v_blocked_domains text[];
  v_skip_spam boolean;
  v_reason text;
  v_spam boolean := false;
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

  select j.config_version, j.blocked_domains, j.skip_previously_spam_domains
    into v_config_version, v_blocked_domains, v_skip_spam
  from public.jobs j
  where j.id = p_job_id;
  if not found then
    raise exception 'job not found: %', p_job_id using errcode = 'P0002';
  end if;

  -- Decide once, at discovery, and store the answer on the row (I8: a later change
  -- to the blocklist or the job never rewrites an existing row).
  -- Order: global blocklist, then this job's blocked domains, then the spam flag.
  if exists (select 1 from public.blocklist b where b.domain = p_domain) then
    v_reason := 'blocklisted';
  elsif p_domain = any (v_blocked_domains) then
    v_reason := 'job_blocked_domain';
  elsif exists (
    select 1 from public.domains d where d.registered_domain = p_domain and d.global_spam
  ) then
    v_spam := true;
    if v_skip_spam then
      v_reason := 'previously_spam';
    end if;
  end if;

  insert into public.opportunities
    (job_id, original_url, normalized_url, host, domain,
     first_source_type, priority, config_version, extras,
     check_status, check_reason, queue_group, filter_reason, flags)
  values
    (p_job_id, p_original_url, p_normalized_url, p_host, p_domain,
     p_source_type, v_priority, v_config_version, p_extras,
     case when v_reason is null then 'pending' else 'skipped' end::public.opportunity_check_status,
     v_reason,
     case when v_reason is null then null else 'auto_filtered' end::public.opportunity_queue_group,
     v_reason,
     case when v_spam then '{"previously_spam": true}'::jsonb else '{}'::jsonb end)
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

  -- Auto-filtered rows are not real finds, so they do not count toward saturation.
  -- v_reason is only known for a new row, so an existing row is read back.
  if not v_created then
    select o.filter_reason into v_reason from public.opportunities o where o.id = v_id;
    select coalesce((o.flags ->> 'previously_spam')::boolean, false) into v_spam
    from public.opportunities o where o.id = v_id;
  end if;

  if v_reason is null then
    insert into public.job_domains (job_id, registered_domain, first_source_type)
    values (p_job_id, p_domain, p_source_type)
    on conflict do nothing
    returning true into v_domain_added;
    v_domain_added := coalesce(v_domain_added, false);
  end if;

  if v_created or v_source_added then
    update public.job_stats s
    set unique_opportunities = s.unique_opportunities + case when v_created then 1 else 0 end,
        duplicates_skipped = s.duplicates_skipped + case when v_created then 0 else 1 end
    where s.job_id = p_job_id;
    if not found then
      raise exception 'job_stats row missing for job %', p_job_id using errcode = 'P0002';
    end if;
  end if;

  return query select v_id, v_created, v_source_added, v_domain_added, v_reason, v_spam;
end;
$$;

revoke all on function public.record_discovery(uuid, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_discovery(uuid, text, text, text, text, text, text, jsonb)
  to worker;