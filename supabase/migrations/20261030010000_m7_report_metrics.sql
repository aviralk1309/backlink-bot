-- M7-S1: retain query/template identity before M8 starts producing search rows.
create table public.job_queries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  activity_key text not null,
  template_id text not null,
  template_version integer not null,
  query_text text not null,
  created_at timestamptz not null default now(),
  constraint job_queries_activity_key_format check (activity_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint job_queries_template_id_format check (template_id ~ '^[a-z0-9_]{1,40}$'),
  constraint job_queries_template_version_positive check (template_version > 0),
  constraint job_queries_query_text_not_blank check (length(btrim(query_text)) > 0)
);
create index job_queries_job_idx on public.job_queries(job_id);
revoke all on public.job_queries from public, anon, authenticated, service_role, worker;
grant select on public.job_queries to authenticated;
alter table public.job_queries enable row level security;
create policy job_queries_select on public.job_queries for select to authenticated
  using (public.has_permission('jobs.view'));

-- Each decision counts once per dimension value. A result found by two queries
-- from one template still counts once for that template.
create function public.report_metrics(
  p_job_id uuid default null, p_from date default null, p_to date default null,
  p_activity text default null
)
returns table (
  dimension text, dimension_key text, approved_count bigint, used_count bigint,
  rejected_count bigint, undecided_count bigint, decided_count bigint,
  approval_rate numeric, low_sample boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports.view') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_from > p_to then
    raise exception 'invalid_report_period' using errcode = '22023';
  end if;

  return query
  with eligible as materialized (
    select o.id, o.job_id, o.review_status, o.first_ready, o.first_ready_rank,
      o.activity_key, coalesce(o.tier_at_review, o.tier)::text as tier_key
    from public.opportunities o
    where o.queue_group in ('ready', 'backlog')
      and (p_job_id is null or o.job_id = p_job_id)
      and (p_activity is null or o.activity_key = p_activity)
      and (o.review_status in ('new', 'in_review') or (p_from is null and p_to is null)
        or exists (
          select 1 from (
            select (r.at at time zone 'UTC')::date as day
            from public.opportunity_reviews r
            where r.opportunity_id = o.id
              and r.from_status is distinct from r.to_status
              and r.to_status in ('approved', 'rejected')
            order by r.at desc, r.id desc limit 1
          ) last_decision
          where (p_from is null or last_decision.day >= p_from)
            and (p_to is null or last_decision.day <= p_to)
        ))
  ), dimensions as (
    select 'all_results'::text as kind, null::text as key, e.review_status
    from eligible e
    union all
    select 'all_results', null, null::public.opportunity_review_status
    union all
    select 'top_50', null, e.review_status
    from eligible e where e.first_ready and e.first_ready_rank <= 50
    union all
    select 'top_50', null, null::public.opportunity_review_status
    union all
    select 'source', s.source_type, e.review_status
    from eligible e
    join lateral (
      select distinct s.source_type from public.opportunity_sources s
      where s.opportunity_id = e.id
    ) s on true
    union all
    select 'query_template', q.activity_key || '/' || q.template_id, e.review_status
    from eligible e
    join lateral (
      select distinct q.activity_key, q.template_id
      from public.opportunity_sources s
      join public.job_queries q on s.source_type = 'google'
        and s.source_ref = q.id::text and q.job_id = e.job_id
      where s.opportunity_id = e.id
    ) q on true
    union all
    select 'activity', e.activity_key, e.review_status from eligible e
    union all
    select 'tier', e.tier_key, e.review_status from eligible e
  ), counts as (
    select d.kind, d.key,
      count(*) filter (where d.review_status = 'approved') as approved,
      count(*) filter (where d.review_status = 'used') as used,
      count(*) filter (where d.review_status = 'rejected') as rejected,
      count(*) filter (where d.review_status in ('new', 'in_review')) as undecided
    from dimensions d group by d.kind, d.key
  )
  select c.kind, c.key, c.approved, c.used, c.rejected, c.undecided,
    c.approved + c.used + c.rejected,
    round((c.approved + c.used)::numeric /
      nullif(c.approved + c.used + c.rejected, 0), 4),
    c.approved + c.used + c.rejected < 20
  from counts c;
end;
$$;
revoke all on function public.report_metrics(uuid,date,date,text) from public, anon, service_role, worker;
grant execute on function public.report_metrics(uuid,date,date,text) to authenticated;

create function public.report_reject_reasons(
  p_job_id uuid default null, p_from date default null, p_to date default null,
  p_activity text default null
)
returns table (reject_reason public.opportunity_reject_reason, rejected_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports.view') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_from > p_to then
    raise exception 'invalid_report_period' using errcode = '22023';
  end if;
  return query
  select r.reason, count(o.id)
  from unnest(enum_range(null::public.opportunity_reject_reason)) as r(reason)
  left join public.opportunities o on o.reject_reason = r.reason
    and o.review_status = 'rejected' and o.queue_group in ('ready', 'backlog')
    and (p_job_id is null or o.job_id = p_job_id)
    and (p_activity is null or o.activity_key = p_activity)
    and (p_from is null or (o.reviewed_at at time zone 'UTC')::date >= p_from)
    and (p_to is null or (o.reviewed_at at time zone 'UTC')::date <= p_to)
  group by r.reason;
end;
$$;
revoke all on function public.report_reject_reasons(uuid,date,date,text) from public, anon, service_role, worker;
grant execute on function public.report_reject_reasons(uuid,date,date,text) to authenticated;

-- Count decision events, including a new decision after reopen; marking Used
-- is a follow-up state change and does not count as another review.
create function public.report_review_throughput(
  p_job_id uuid default null, p_from date default null, p_to date default null,
  p_activity text default null
)
returns table (day date, approved_count bigint, rejected_count bigint, decided_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports.view') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_from > p_to then
    raise exception 'invalid_report_period' using errcode = '22023';
  end if;
  return query
  select (r.at at time zone 'UTC')::date,
    count(*) filter (where r.to_status = 'approved'),
    count(*) filter (where r.to_status = 'rejected'), count(*)
  from public.opportunity_reviews r
  join public.opportunities o on o.id = r.opportunity_id
  where r.from_status is distinct from r.to_status
    and r.to_status in ('approved', 'rejected')
    and r.queue_group in ('ready', 'backlog')
    and (p_job_id is null or o.job_id = p_job_id)
    and (p_activity is null or o.activity_key = p_activity)
    and (p_from is null or (r.at at time zone 'UTC')::date >= p_from)
    and (p_to is null or (r.at at time zone 'UTC')::date <= p_to)
  group by 1 order by 1;
end;
$$;
revoke all on function public.report_review_throughput(uuid,date,date,text) from public, anon, service_role, worker;
grant execute on function public.report_review_throughput(uuid,date,date,text) to authenticated;
