-- M8-S7: bounded query history reads and an explicit, audited retry.
create function public.job_query_yield(p_job_id uuid)
returns table (
  activity_key text, template_id text, template_version integer,
  queries_total bigint, queries_done bigint, queries_failed bigint,
  credits_used bigint, result_count bigint, new_unique_domains bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('jobs.view') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return query
  select q.activity_key, q.template_id, q.template_version,
    count(*), count(*) filter (where q.status = 'done'),
    count(*) filter (where q.status = 'failed'),
    coalesce(sum(q.credits_used), 0), coalesce(sum(q.result_count), 0),
    coalesce(sum(q.new_unique_domains), 0)
  from public.job_queries q where q.job_id = p_job_id
  group by q.activity_key, q.template_id, q.template_version
  order by q.activity_key, q.template_id, q.template_version;
end;
$$;
revoke all on function public.job_query_yield(uuid) from public, anon, service_role, worker;
grant execute on function public.job_query_yield(uuid) to authenticated;

create function public.retry_job_query(p_job_id uuid, p_query_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
  v_query public.job_queries;
  v_credits integer;
  v_inflight integer;
  v_reservation integer;
  v_reopened boolean := false;
begin
  if not public.has_permission('jobs.control') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found then raise exception 'job_not_found' using errcode = '22023'; end if;
  select * into v_query from public.job_queries q
    where q.id = p_query_id and q.job_id = p_job_id for update;
  if not found or v_query.status <> 'failed' then
    raise exception 'query_not_failed' using errcode = '22023';
  end if;
  if v_job.status not in ('running', 'paused', 'saturated')
    and not (v_job.status = 'completed' and v_job.status_reason = 'drained')
    and not (v_job.status = 'failed' and v_job.status_reason = 'all_queries_failed') then
    raise exception 'job_not_retryable' using errcode = '22023';
  end if;

  select s.credits_used into v_credits from public.job_stats s where s.job_id = p_job_id;
  select count(*) into v_inflight from public.job_queries q
    where q.job_id = p_job_id and q.status = 'running';
  select greatest(1, coalesce(max(q.credits_used), 0)) into v_reservation
    from public.job_queries q where q.job_id = p_job_id and q.status = 'done';
  if v_credits + (v_inflight + 1) * v_reservation > v_job.budget_credits then
    raise exception 'query_budget_reached' using errcode = '22023';
  end if;

  update public.job_queries set status = 'pending', attempts = 0,
    locked_by = null, lease_expires_at = null, error = null, completed_at = null
    where id = p_query_id;
  if v_job.status in ('completed', 'failed') then
    v_reopened := true;
    update public.jobs set status = 'running', status_reason = null, finished_at = null
      where id = p_job_id;
    update public.job_stats set saturation_recheck_after = queries_done + v_job.saturation_n
      where job_id = p_job_id;
    insert into public.job_events(job_id, type, payload, actor, config_version)
      values (p_job_id, 'status_changed', jsonb_build_object(
        'from', v_job.status, 'to', 'running', 'action', 'retry_query'),
        auth.uid(), v_job.config_version);
  end if;
  insert into public.job_events(job_id, type, payload, actor, config_version)
    values (p_job_id, 'query_retried', jsonb_build_object('query_id', p_query_id),
      auth.uid(), v_job.config_version);
  return case when v_reopened then 'reopened' else 'queued' end;
end;
$$;
revoke all on function public.retry_job_query(uuid,uuid)
  from public, anon, service_role, worker;
grant execute on function public.retry_job_query(uuid,uuid) to authenticated;
