-- Keep existing result and export filters compatible with site-crawl provenance.
-- Rollback: restore these functions from their M6 source migrations.
create or replace function public.list_job_results(
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
    or p_source is not null and p_source not in ('google','competitor_csv','seed_list','site_crawl')
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

create or replace function public.list_job_result_domains(
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
    or p_source is not null and p_source not in ('google','competitor_csv','seed_list','site_crawl')
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
create or replace function public.export_result_batch(
  p_job_id uuid,
  p_queue public.opportunity_queue_group default 'ready',
  p_tier public.opportunity_tier default null,
  p_activity text default null,
  p_source text default null,
  p_status public.opportunity_review_status default null,
  p_domain text default null,
  p_query text default null,
  p_flag text default null,
  p_after uuid default null,
  p_limit integer default 500
) returns table (
  id uuid, normalized_url text, original_url text, domain text,
  score numeric, tier public.opportunity_tier, score_breakdown jsonb,
  source_types text[], overlap_count integer, activity_key text,
  review_status public.opportunity_review_status,
  reject_reason public.opportunity_reject_reason, notes text,
  external_metrics jsonb, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_can_view_filtered boolean;
begin
  v_can_view_filtered := public.has_permission('results.view_filtered');
  if not public.has_permission('jobs.view') or not public.has_permission('results.view')
    or not public.has_permission('results.export')
    or (p_queue = 'auto_filtered' and not v_can_view_filtered) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_job_id is null or p_limit is null or p_limit not between 1 and 500
    or (p_source is not null and p_source not in ('google','competitor_csv','seed_list','site_crawl'))
    or (p_flag is not null and p_flag not in
      ('client_unknown','previous_spam','already_links','domain_cap'))
    or char_length(coalesce(p_query,'')) > 200
    or char_length(coalesce(p_activity,'')) > 100
    or char_length(coalesce(p_domain,'')) > 253 then
    raise exception 'invalid_results_filter' using errcode = '22023';
  end if;

  return query
    select o.id,o.normalized_url,o.original_url,o.domain,o.score,o.tier,
      o.score_breakdown,
      array(select distinct s.source_type from public.opportunity_sources s
            where s.opportunity_id=o.id order by s.source_type),
      o.overlap_count,o.activity_key,o.review_status,o.reject_reason,o.notes,
      o.external_metrics,o.created_at
    from public.result_matches(p_job_id,p_queue,p_tier,p_activity,p_source,
      p_status,p_domain,p_query,p_flag,v_can_view_filtered) o
    -- shortcut: live edits can change membership between batches; use snapshot export jobs if immutable exports are needed.
    where p_after is null or o.id > p_after
    order by o.id limit p_limit;
end;
$$;
revoke all on function public.export_result_batch(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,uuid,integer)
  from public,anon,authenticated,service_role,worker;
grant execute on function public.export_result_batch(uuid,public.opportunity_queue_group,
  public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,uuid,integer)
  to authenticated;

