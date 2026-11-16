-- M4-S7: Create opportunities from gap and seed lists
--
-- Design notes
--  * For each gap domain, linking URLs from confirmed competitor CSV files are
--    recorded through record_discovery with source_type='competitor_csv' and
--    source_ref=competitor_label (G6).
--  * Gap opportunities get priority 0 (gap runs first, I6).
--  * Store overlap_count and client_link_status on opportunities, along with
--    any extra mapped columns from the CSV (M4-S7).
--  * When a URL is discovered by a second competitor file or seed list:
--    - priority is least(existing, new)
--    - overlap_count is greatest(existing, new)
--    - client_link_status promotes to 'known_partial' if either is known_partial
--    - extras are merged
--    - duplicates_skipped counter in job_stats is incremented
--  * Re-running is idempotent: creates no duplicate rows and does not move counters.

-- ---------------------------------------------------------------------
-- 1. Update record_discovery to handle overlap_count and client_link_status
-- ---------------------------------------------------------------------
create or replace function public.record_discovery(
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
  v_overlap_count integer;
  v_client_link_status text;
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

  v_overlap_count := coalesce((p_extras->>'overlap_count')::integer, 0);
  v_client_link_status := coalesce(nullif(p_extras->>'client_link_status', ''), 'unknown');

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
     first_source_type, priority, overlap_count, client_link_status,
     config_version, extras,
     check_status, check_reason, queue_group, filter_reason, flags)
  values
    (p_job_id, p_original_url, p_normalized_url, p_host, p_domain,
     p_source_type, v_priority, v_overlap_count, v_client_link_status,
     v_config_version, p_extras,
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
          overlap_count = greatest(o.overlap_count, v_overlap_count),
          client_link_status = case
            when o.client_link_status = 'known_partial' or v_client_link_status = 'known_partial' then 'known_partial'
            else o.client_link_status
          end,
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

-- ---------------------------------------------------------------------
-- 2. import_job_gap_opportunities
-- ---------------------------------------------------------------------
create or replace function public.import_job_gap_opportunities(p_job_id uuid)
returns table (
  total_candidates integer,
  opportunities_created integer,
  duplicates_skipped integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  v_res record;
  v_total integer := 0;
  v_created integer := 0;
  v_dupes integer := 0;
begin
  for item in
    select
      cr.raw_url,
      cr.normalized_url,
      cr.host,
      cr.domain,
      cu.competitor_label as source_ref,
      cr.extras || jsonb_build_object(
        'overlap_count', g.overlap_count,
        'client_link_status', g.client_link_status
      ) as extras
    from public.get_job_gap_domains(p_job_id) g
    join public.csv_uploads cu
      on cu.job_id = p_job_id
     and cu.kind = 'competitor'
     and cu.status = 'confirmed'
    join public.csv_rows cr
      on cr.upload_id = cu.id
     and cr.domain = g.domain
     and cr.is_valid = true
     and not cr.is_duplicate
    order by cr.row_no, cr.normalized_url
  loop
    v_total := v_total + 1;
    select * into v_res
    from public.record_discovery(
      p_job_id,
      item.raw_url,
      item.normalized_url,
      item.host,
      item.domain,
      'competitor_csv',
      item.source_ref,
      item.extras
    );
    if v_res.created then
      v_created := v_created + 1;
    elsif v_res.source_added then
      v_dupes := v_dupes + 1;
    end if;
  end loop;

  return query select v_total, v_created, v_dupes;
end;
$$;

revoke all on function public.import_job_gap_opportunities(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.import_job_gap_opportunities(uuid)
  to worker;

-- ---------------------------------------------------------------------
-- 3. import_job_seed_opportunities
-- ---------------------------------------------------------------------
create or replace function public.import_job_seed_opportunities(
  p_job_id uuid,
  p_seeds jsonb
)
returns table (
  total_candidates integer,
  opportunities_created integer,
  duplicates_skipped integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  elem jsonb;
  v_res record;
  v_total integer := 0;
  v_created integer := 0;
  v_dupes integer := 0;
begin
  if jsonb_typeof(p_seeds) <> 'array' then
    raise exception 'seeds must be a JSON array' using errcode = '22023';
  end if;

  for elem in select jsonb_array_elements(p_seeds)
  loop
    v_total := v_total + 1;
    select * into v_res
    from public.record_discovery(
      p_job_id,
      elem->>'original',
      elem->>'normalized',
      elem->>'host',
      elem->>'domain',
      'seed_list',
      coalesce(elem->>'source_ref', 'seed_list'),
      coalesce(elem->'extras', '{}'::jsonb)
    );
    if v_res.created then
      v_created := v_created + 1;
    elsif v_res.source_added then
      v_dupes := v_dupes + 1;
    end if;
  end loop;

  return query select v_total, v_created, v_dupes;
end;
$$;

revoke all on function public.import_job_seed_opportunities(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.import_job_seed_opportunities(uuid, jsonb)
  to worker;

-- ---------------------------------------------------------------------
-- 4. Update worker_pick_up_next_job to import gap opportunities
-- ---------------------------------------------------------------------
create or replace function public.worker_pick_up_next_job()
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
  perform public.import_job_gap_opportunities(v_id);
  return query select v_id, 'running'::text;
end;
$$;
