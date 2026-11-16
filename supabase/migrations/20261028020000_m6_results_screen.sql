-- M6-S2: bounded result pages, domain groups, and literal URL search.
create index opportunities_result_newest_idx
  on public.opportunities(job_id, queue_group, created_at desc, id);
create index opportunities_result_url_search_idx
  on public.opportunities using gin(normalized_url extensions.gin_trgm_ops);
create index opportunities_result_domain_search_idx
  on public.opportunities using gin(domain extensions.gin_trgm_ops);

-- Called only by the permission-checked definer functions below.
create function public.result_matches(
  p_job_id uuid,
  p_queue public.opportunity_queue_group,
  p_tier public.opportunity_tier,
  p_activity text,
  p_source text,
  p_status public.opportunity_review_status,
  p_domain text,
  p_query text,
  p_flag text,
  p_include_filtered boolean
) returns setof public.opportunities language sql stable security invoker as $$
  select o.* from public.opportunities o
  where o.job_id = p_job_id
    and (p_include_filtered or o.queue_group is distinct from 'auto_filtered')
    and (p_queue is null or o.queue_group = p_queue)
    and (p_tier is null or o.tier = p_tier)
    and (p_activity is null or o.activity_key = p_activity)
    and (p_status is null or o.review_status = p_status)
    and (p_domain is null or o.domain = p_domain)
    and (p_query is null or o.normalized_url ilike '%' || p_query || '%'
         or o.domain ilike '%' || p_query || '%')
    and (p_source is null or exists (
      select 1 from public.opportunity_sources s
      where s.opportunity_id = o.id and s.source_type = p_source
    ))
    and (p_flag is null or case p_flag
      when 'client_unknown' then o.client_link_status = 'unknown'
      when 'previous_spam' then o.flags->>'previously_spam' = 'true'
      when 'already_links' then o.flags->>'already_links_to_client' = 'true'
      when 'domain_cap' then o.check_reason = 'domain_cap'
      else false end);
$$;
revoke all on function public.result_matches(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,boolean)
  from public,anon,authenticated,service_role,worker;

create function public.list_job_results(
  p_job_id uuid,
  p_queue public.opportunity_queue_group default 'ready',
  p_tier public.opportunity_tier default null,
  p_activity text default null,
  p_source text default null,
  p_status public.opportunity_review_status default null,
  p_domain text default null,
  p_query text default null,
  p_flag text default null,
  p_sort text default 'score',
  p_after uuid default null,
  p_limit integer default 50
) returns table (
  id uuid, normalized_url text, domain text, score numeric,
  tier public.opportunity_tier, score_breakdown jsonb,
  first_source_type text, source_types text[], overlap_count integer,
  activity_key text, review_status public.opportunity_review_status,
  flags jsonb, client_link_status text, check_reason text, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_anchor public.opportunities; v_can_view_filtered boolean;
begin
  v_can_view_filtered := public.has_permission('results.view_filtered');
  if not public.has_permission('results.view')
    or (p_queue = 'auto_filtered' and not v_can_view_filtered) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or p_sort is null or p_sort not in ('score','newest')
    or p_source is not null and p_source not in ('google','competitor_csv','seed_list')
    or p_flag is not null and p_flag not in
      ('client_unknown','previous_spam','already_links','domain_cap')
    or char_length(coalesce(p_query,'')) > 200 then
    raise exception 'invalid_results_filter' using errcode = '22023';
  end if;
  if p_after is not null then
    -- shortcut: rescoring can reorder live rows between pages, use snapshots if fixed historical paging is needed.
    select o.* into v_anchor from public.result_matches(p_job_id,p_queue,p_tier,
      p_activity,p_source,p_status,p_domain,p_query,p_flag,v_can_view_filtered) o where o.id = p_after;
    if not found then return; end if;
  end if;

  if p_sort = 'score' then
    return query
      select o.id,o.normalized_url,o.domain,o.score,o.tier,o.score_breakdown,
        o.first_source_type,
        array(select distinct s.source_type from public.opportunity_sources s
              where s.opportunity_id=o.id order by s.source_type),
        o.overlap_count,o.activity_key,o.review_status,o.flags,
        o.client_link_status,o.check_reason,o.created_at
      from public.result_matches(p_job_id,p_queue,p_tier,p_activity,p_source,
        p_status,p_domain,p_query,p_flag,v_can_view_filtered) o
      where p_after is null
        or (v_anchor.score is not null and
            (o.score < v_anchor.score or o.score is null))
        or (o.score is not distinct from v_anchor.score and
            (o.overlap_count < v_anchor.overlap_count
             or (o.overlap_count = v_anchor.overlap_count and
                 (o.created_at,o.id) > (v_anchor.created_at,v_anchor.id))))
      order by o.score desc nulls last,o.overlap_count desc,o.created_at,o.id
      limit p_limit + 1;
  else
    return query
      select o.id,o.normalized_url,o.domain,o.score,o.tier,o.score_breakdown,
        o.first_source_type,
        array(select distinct s.source_type from public.opportunity_sources s
              where s.opportunity_id=o.id order by s.source_type),
        o.overlap_count,o.activity_key,o.review_status,o.flags,
        o.client_link_status,o.check_reason,o.created_at
      from public.result_matches(p_job_id,p_queue,p_tier,p_activity,p_source,
        p_status,p_domain,p_query,p_flag,v_can_view_filtered) o
      where p_after is null or o.created_at < v_anchor.created_at
        or (o.created_at = v_anchor.created_at and o.id > v_anchor.id)
      order by o.created_at desc,o.id
      limit p_limit + 1;
  end if;
end;
$$;
revoke all on function public.list_job_results(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,text,uuid,integer)
  from public,anon,authenticated,service_role,worker;
grant execute on function public.list_job_results(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,text,uuid,integer)
  to authenticated;

create function public.list_job_result_domains(
  p_job_id uuid,
  p_queue public.opportunity_queue_group default 'ready',
  p_tier public.opportunity_tier default null,
  p_activity text default null,
  p_source text default null,
  p_status public.opportunity_review_status default null,
  p_domain text default null,
  p_query text default null,
  p_flag text default null,
  p_after text default null,
  p_limit integer default 50
) returns table (domain text, result_count bigint, best_score numeric, preview_urls text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_can_view_filtered boolean;
begin
  v_can_view_filtered := public.has_permission('results.view_filtered');
  if not public.has_permission('results.view')
    or (p_queue = 'auto_filtered' and not v_can_view_filtered) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or p_source is not null and p_source not in ('google','competitor_csv','seed_list')
    or p_flag is not null and p_flag not in
      ('client_unknown','previous_spam','already_links','domain_cap')
    or char_length(coalesce(p_query,'')) > 200 or char_length(coalesce(p_after,'')) > 253 then
    raise exception 'invalid_results_filter' using errcode = '22023';
  end if;

  return query
    with groups as (
      select o.domain,count(*)::bigint as result_count,max(o.score) as best_score
      from public.result_matches(p_job_id,p_queue,p_tier,p_activity,p_source,
        p_status,p_domain,p_query,p_flag,v_can_view_filtered) o
      where p_after is null or o.domain > p_after
      group by o.domain order by o.domain limit p_limit + 1
    )
    select g.domain,g.result_count,g.best_score,
      array(select o.normalized_url from public.result_matches(p_job_id,p_queue,
        p_tier,p_activity,p_source,p_status,g.domain,p_query,p_flag,v_can_view_filtered) o
        order by o.score desc nulls last,o.overlap_count desc,o.created_at,o.id
        limit 3)
    from groups g order by g.domain;
end;
$$;
revoke all on function public.list_job_result_domains(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,text,integer)
  from public,anon,authenticated,service_role,worker;
grant execute on function public.list_job_result_domains(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,text,integer)
  to authenticated;
