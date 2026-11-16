-- Keep the pending Ready window ranked as checks finish; claimed rows stay put.
-- Rollback: restore worker_assign_opportunity_queue from 20261029040000_m6_pending_queue.sql.
create or replace function public.worker_assign_opportunity_queue(
  p_id uuid,p_worker text,p_attempt integer,p_config_version integer
) returns public.opportunity_queue_group
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
  v_row public.opportunities;
  v_worst public.opportunities;
  v_best uuid;
  v_ready integer;
  v_first integer;
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
    where job_id=v_job.id and queue_group='ready'
      and review_status in ('new','in_review');
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
      return 'ready'::public.opportunity_queue_group;
    end if;
    update public.opportunities set queue_group='ready',check_status='done',
      locked_by=null,lease_expires_at=null where id=p_id;
    return 'ready'::public.opportunity_queue_group;
  else
    select o.* into v_worst from public.opportunities o
      where o.job_id=v_job.id and o.queue_group='ready' and o.review_status='new'
      order by (o.tier='unchecked') desc nulls first,o.score asc nulls first,
        o.overlap_count asc,o.created_at desc,o.id desc
      limit 1 for update;
    if found then
      select o.id into v_best from public.opportunities o
        where o.id in (p_id,v_worst.id)
        order by (o.tier='unchecked') asc nulls last,o.score desc nulls last,
          o.overlap_count desc,o.created_at,o.id limit 1;
      if v_best=p_id then
        update public.opportunities set queue_group='backlog' where id=v_worst.id;
        update public.opportunities set queue_group='ready',check_status='done',
          locked_by=null,lease_expires_at=null where id=p_id;
        return 'ready'::public.opportunity_queue_group;
      end if;
    end if;
    update public.opportunities set queue_group='backlog',check_status='done',
      locked_by=null,lease_expires_at=null where id=p_id;
    return 'backlog'::public.opportunity_queue_group;
  end if;
end;
$$;
