-- M5-S8 queue membership. The first Ready window is permanent evidence for G16;
-- later replenishment/releases never join that initial cohort.
alter table public.opportunities
  add column first_ready boolean not null default false,
  add column first_ready_rank integer;
alter table public.opportunities add constraint opportunities_first_ready_pair
  check ((first_ready and first_ready_rank is not null and first_ready_rank > 0)
      or (not first_ready and first_ready_rank is null));
create unique index opportunities_first_ready_rank
  on public.opportunities(job_id,first_ready_rank) where first_ready;

create function public.worker_assign_opportunity_queue(
  p_id uuid,p_worker text,p_attempt integer,p_config_version integer
) returns public.opportunity_queue_group
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_row public.opportunities; v_ready integer; v_first integer;
begin
  -- Match all queue transitions' lock order: job, then opportunity.
  select j.* into v_job from public.jobs j where j.id=(
    select o.job_id from public.opportunities o where o.id=p_id
  ) for no key update;
  if not found then return null; end if;
  select o.* into v_row from public.opportunities o where o.id=p_id for update;
  if not found or v_row.check_status <> 'running' or v_row.locked_by is distinct from p_worker
    or v_row.attempts <> p_attempt or v_row.config_version <> p_config_version
    or v_row.lease_expires_at <= clock_timestamp() or v_row.score is null or v_row.tier is null
    or v_row.duplicate_of is not null or v_row.queue_group='auto_filtered'
    or not exists(select 1 from public.opportunity_checks c
      where c.opportunity_id=p_id and c.config_version=p_config_version)
    or exists(select 1 from public.opportunity_checks c
      where c.opportunity_id=p_id and c.config_version<>p_config_version)
  then return null; end if;

  select count(*)::integer into v_ready from public.opportunities
    where job_id=v_job.id and queue_group='ready';
  select count(*)::integer into v_first from public.opportunities
    where job_id=v_job.id and first_ready;
  if v_row.queue_group is not null then
    -- Preserve any membership already established; never move a shown row.
    update public.opportunities set check_status='done',locked_by=null,lease_expires_at=null
      where id=p_id;
    return v_row.queue_group;
  elsif v_ready < v_job.review_queue_size then
    if v_first < v_job.review_queue_size then
      update public.opportunities set queue_group='ready',first_ready=true,
        first_ready_rank=(select coalesce(max(first_ready_rank),0)+1 from public.opportunities
                          where job_id=v_job.id and first_ready),
        check_status='done',locked_by=null,lease_expires_at=null where id=p_id;
      return 'ready';
    end if;
    update public.opportunities set queue_group='ready',check_status='done',
      locked_by=null,lease_expires_at=null where id=p_id;
    return 'ready';
  else
    update public.opportunities set queue_group='backlog',check_status='done',
      locked_by=null,lease_expires_at=null where id=p_id;
    return 'backlog';
  end if;
end;
$$;
revoke all on function public.worker_assign_opportunity_queue(uuid,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.worker_assign_opportunity_queue(uuid,text,integer,integer) to worker;

create function public.release_backlog(p_job_id uuid,p_limit integer default 25)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_ready integer; v_capacity integer; v_released integer := 0; v_row record;
begin
  if not public.has_permission('results.release_batch')
    or not public.has_permission('results.view') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid_release_limit' using errcode='22023';
  end if;
  select j.* into v_job from public.jobs j where j.id=p_job_id for no key update;
  if not found then raise exception 'job_not_found' using errcode='P0002'; end if;
  select count(*)::integer into v_ready from public.opportunities
    where job_id=p_job_id and queue_group='ready';
  v_capacity := least(p_limit,greatest(0,v_job.review_queue_size-v_ready));
  if v_capacity=0 then return 0; end if;

  for v_row in
    select o.id from public.opportunities o where o.job_id=p_job_id
      and o.queue_group='backlog' and o.filter_reason is null and o.duplicate_of is null
      and o.score is not null and o.tier is not null
      and (o.check_status='done' or (o.check_status='skipped' and o.check_reason='domain_cap'))
    order by (o.tier='unchecked') asc,o.score desc,o.overlap_count desc,o.created_at asc,o.id asc
    limit v_capacity for update of o skip locked
  loop
    update public.opportunities set queue_group='ready' where id=v_row.id;
    v_released := v_released+1;
  end loop;
  if v_released > 0 then
    insert into public.job_events(job_id,type,actor,payload)
      values(p_job_id,'backlog_released',auth.uid(),jsonb_build_object('released',v_released));
  end if;
  return v_released;
end;
$$;
revoke all on function public.release_backlog(uuid,integer) from public,anon,service_role,worker;
grant execute on function public.release_backlog(uuid,integer) to authenticated;
