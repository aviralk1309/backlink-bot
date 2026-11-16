-- Tighten backlog release to visible jobs and protect G16 cohort evidence.
create or replace function public.release_backlog(p_job_id uuid,p_limit integer default 25)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_ready integer; v_capacity integer; v_released integer := 0; v_row record;
begin
  if not public.has_permission('jobs.view')
    or not public.has_permission('results.release_batch')
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

create function public.opportunities_first_ready_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' and new.first_ready then
    raise exception 'first_ready_is_assignment_managed' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.first_ready and
     (new.first_ready is distinct from old.first_ready
       or new.first_ready_rank is distinct from old.first_ready_rank) then
    raise exception 'first_ready_membership_immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.opportunities_first_ready_immutable()
  from public,anon,authenticated,service_role,worker;
create trigger opportunities_first_ready_immutable before insert or update of first_ready,first_ready_rank
  on public.opportunities for each row execute function public.opportunities_first_ready_immutable();

