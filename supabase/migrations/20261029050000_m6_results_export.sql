-- M6-S7: bounded, permission-checked export pages and one audit event per download.
create index opportunities_export_job_id_idx on public.opportunities(job_id,id);

create function public.export_result_batch(
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
    or (p_source is not null and p_source not in ('google','competitor_csv','seed_list'))
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

create function public.log_result_export(p_job_id uuid,p_filters jsonb,p_columns text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('jobs.view') or not public.has_permission('results.view')
    or not public.has_permission('results.export') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_job_id is null or p_filters is null or jsonb_typeof(p_filters) <> 'object'
    or octet_length(p_filters::text) > 4096 or p_columns is null
    or cardinality(p_columns) not between 1 and 20
    or octet_length(to_jsonb(p_columns)::text) > 2048 then
    raise exception 'invalid_export_request' using errcode = '22023';
  end if;
  if not exists(select 1 from public.jobs j where j.id=p_job_id) then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  insert into public.job_events(job_id,type,actor,payload)
    values(p_job_id,'results_export_started',auth.uid(),
      jsonb_build_object('filters',p_filters,'columns',p_columns));
end;
$$;
revoke all on function public.log_result_export(uuid,jsonb,text[])
  from public,anon,authenticated,service_role,worker;
grant execute on function public.log_result_export(uuid,jsonb,text[]) to authenticated;
