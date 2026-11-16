-- Depth-one site prospects use the existing opportunity pipeline and source history.
-- Rollback: restore the three source checks and record_discovery from
-- 20261023040000_m4_gap_import.sql, then drop record_site_crawl_candidates.
alter table public.opportunities drop constraint opportunities_first_source_type_check;
alter table public.opportunities add constraint opportunities_first_source_type_check
  check (first_source_type in ('google','competitor_csv','seed_list','site_crawl'));
alter table public.opportunity_sources drop constraint opportunity_sources_source_type_check;
alter table public.opportunity_sources add constraint opportunity_sources_source_type_check
  check (source_type in ('google','competitor_csv','seed_list','site_crawl'));
alter table public.job_domains drop constraint job_domains_first_source_type_check;
alter table public.job_domains add constraint job_domains_first_source_type_check
  check (first_source_type in ('google','competitor_csv','seed_list','site_crawl'));
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
    when 'site_crawl' then 3
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

-- A job lock makes the 20-page job ceiling and two-page domain ceiling atomic.
-- The usual opportunity claim path then fetches and checks each child once.
create function public.record_site_crawl_candidates(
  p_job_id uuid,p_parent_id uuid,p_candidates jsonb
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
  v_parent public.opportunities;
  v_item record;
  v_result record;
  v_total integer;
  v_domain_total integer;
  v_added integer := 0;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array'
    or jsonb_array_length(p_candidates) > 2 then
    raise exception 'invalid_crawl_candidates' using errcode='22023';
  end if;
  select j.* into v_job from public.jobs j where j.id=p_job_id for no key update;
  if not found or v_job.status <> 'running' or v_job.started_at is null
    or clock_timestamp() > v_job.started_at + interval '5 minutes' then
    return 0;
  end if;
  select o.* into v_parent from public.opportunities o
    where o.id=p_parent_id and o.job_id=p_job_id and o.check_status='done'
      and o.first_source_type <> 'site_crawl'
      and not exists (select 1 from public.opportunity_sources s
        where s.opportunity_id=o.id and s.source_type='site_crawl');
  if not found then return 0; end if;
  select count(*)::integer into v_total from public.opportunities o
    where o.job_id=p_job_id and o.first_source_type='site_crawl';
  for v_item in select * from jsonb_to_recordset(p_candidates) as x(
    original_url text,normalized_url text,host text,domain text
  ) loop
    exit when v_total >= 20;
    if v_item.domain is distinct from v_parent.domain
      or v_item.normalized_url is null or v_item.host is null
      or v_item.original_url is null then continue; end if;
    select count(*)::integer into v_domain_total from public.opportunities o
      where o.job_id=p_job_id and o.domain=v_parent.domain
        and o.first_source_type='site_crawl';
    if v_domain_total >= 2 then exit; end if;
    select * into v_result from public.record_discovery(
      p_job_id,v_item.original_url,v_item.normalized_url,v_item.host,v_item.domain,
      'site_crawl',p_parent_id::text,'{}'::jsonb
    );
    if v_result.created then
      v_total := v_total + 1;
      v_added := v_added + 1;
    end if;
  end loop;
  return v_added;
end;
$$;
revoke all on function public.record_site_crawl_candidates(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_site_crawl_candidates(uuid,uuid,jsonb) to worker;
