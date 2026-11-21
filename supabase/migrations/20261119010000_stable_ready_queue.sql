-- D2: once shown in Ready, an undecided row stays until a reviewer acts.
-- Rollback: restore worker_assign_opportunity_queue from 20261104020000_quality_ready_queue.sql.
create or replace function public.worker_assign_opportunity_queue(
  p_id uuid,p_worker text,p_attempt integer,p_config_version integer
) returns public.opportunity_queue_group
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
  v_row public.opportunities;
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
    update public.opportunities set queue_group='backlog',check_status='done',
      locked_by=null,lease_expires_at=null where id=p_id;
    return 'backlog'::public.opportunity_queue_group;
  end if;
end;
$$;
