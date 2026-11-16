-- Current delivery outcomes and paid query cost, grouped without multiplying query spend.
create or replace function public.report_link_delivery(p_job_id uuid default null, p_activity text default null)
returns table (
  dimension text, dimension_key text, submitted_count bigint, verified_count bigint,
  unverified_count bigint, unknown_count bigint, credits_used bigint,
  credits_per_verified numeric
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports.view') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return query
  with placement_dimensions as (
    select 'client'::text as dim,j.client_domain::text as key,p.id,p.verification_status
      from public.link_placements p join public.jobs j on j.id=p.job_id
      join public.opportunities o on o.id=p.opportunity_id
      where (p_job_id is null or p.job_id=p_job_id)
        and (p_activity is null or o.activity_key=p_activity)
        and p.outreach_status='live'
    union all
    select 'activity',o.activity_key,p.id,p.verification_status
      from public.link_placements p join public.opportunities o on o.id=p.opportunity_id
      where (p_job_id is null or p.job_id=p_job_id)
        and (p_activity is null or o.activity_key=p_activity)
        and p.outreach_status='live'
    union all
    select distinct 'template',q.activity_key||'/'||q.template_id,p.id,p.verification_status
      from public.link_placements p join public.opportunities o on o.id=p.opportunity_id
      join public.opportunity_sources s on s.opportunity_id=o.id and s.source_type='google'
      join public.job_queries q on q.id::text=s.source_ref and q.job_id=o.job_id
      where (p_job_id is null or p.job_id=p_job_id)
        and (p_activity is null or o.activity_key=p_activity)
        and p.outreach_status='live'
    union all
    select distinct 'query',q.query_text,p.id,p.verification_status
      from public.link_placements p join public.opportunities o on o.id=p.opportunity_id
      join public.opportunity_sources s on s.opportunity_id=o.id and s.source_type='google'
      join public.job_queries q on q.id::text=s.source_ref and q.job_id=o.job_id
      where (p_job_id is null or p.job_id=p_job_id)
        and (p_activity is null or o.activity_key=p_activity)
        and p.outreach_status='live'
  ), delivered as (
    select d.dim,d.key,count(*) as submitted,
      count(*) filter(where d.verification_status='verified') as verified,
      count(*) filter(where d.verification_status='unverified') as unverified,
      count(*) filter(where d.verification_status='unknown') as unknown_count
    from placement_dimensions d group by d.dim,d.key
  ), query_cost as (
    select q.*,j.client_domain from public.job_queries q
      join public.jobs j on j.id=q.job_id
      where q.status='done' and (p_job_id is null or q.job_id=p_job_id)
        and (p_activity is null or q.activity_key=p_activity)
  ), cost_dimensions as (
    select 'client'::text as dim,q.client_domain::text as key,q.credits_used from query_cost q
    union all select 'activity',q.activity_key,q.credits_used from query_cost q
    union all select 'template',q.activity_key||'/'||q.template_id,q.credits_used from query_cost q
    union all select 'query',q.query_text,q.credits_used from query_cost q
  ), cost as (
    select c.dim,c.key,sum(coalesce(c.credits_used,0))::bigint as credits
      from cost_dimensions c group by c.dim,c.key
  )
  select coalesce(d.dim,c.dim),coalesce(d.key,c.key),coalesce(d.submitted,0),
    coalesce(d.verified,0),coalesce(d.unverified,0),coalesce(d.unknown_count,0),
    coalesce(c.credits,0),
    round(coalesce(c.credits,0)::numeric/nullif(d.verified,0),2)
  from delivered d full join cost c on c.dim=d.dim and c.key is not distinct from d.key
  order by 1,2;
end;
$$;
revoke all on function public.report_link_delivery(uuid,text) from public,anon,service_role,worker;
grant execute on function public.report_link_delivery(uuid,text) to authenticated;
