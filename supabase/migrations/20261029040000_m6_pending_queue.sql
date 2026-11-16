-- M6-S6: decided results keep their queue history but free a pending Ready slot.
create or replace function public.worker_assign_opportunity_queue(
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
    update public.opportunities set queue_group='backlog',check_status='done',
      locked_by=null,lease_expires_at=null where id=p_id;
    return 'backlog'::public.opportunity_queue_group;
  end if;
end;
$$;

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
    where job_id=p_job_id and queue_group='ready'
      and review_status in ('new','in_review');
  v_capacity := least(p_limit,greatest(0,v_job.review_queue_size-v_ready));
  if v_capacity=0 then return 0; end if;

  for v_row in
    select o.id from public.opportunities o where o.job_id=p_job_id
      and o.queue_group='backlog' and o.review_status in ('new','in_review')
      and o.filter_reason is null and o.duplicate_of is null
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

create or replace function public.review_opportunities(
  p_job_id uuid, p_rows jsonb, p_action text,
  p_reason text default null, p_note text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_row public.opportunities;
  v_version bigint;
  v_total integer;
  v_distinct integer;
  v_invalid integer;
  v_found integer := 0;
  v_notes text;
  v_queue_limit integer;
begin
  if not public.has_permission('results.view')
    or (p_action = 'reopen' and not public.has_permission('results.reopen'))
    or (p_action <> 'reopen' and not public.has_permission('results.review')) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_job_id is null or p_action is null
    or p_action not in ('claim', 'approve', 'reject', 'used', 'reopen')
    or p_rows is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 50
    or (p_note is not null and char_length(p_note) > 4000) then
    raise exception 'invalid_review_request' using errcode = '22023';
  end if;
  if (p_action = 'reject' and
      (p_reason is null or p_reason not in
        ('spam', 'off_topic', 'no_link_option', 'already_have', 'other')
        or (p_reason = 'other' and length(btrim(coalesce(p_note, ''))) = 0)))
    or (p_action <> 'reject' and (p_reason is not null or p_note is not null))
    or (p_action in ('claim', 'used', 'reopen') and jsonb_array_length(p_rows) <> 1) then
    raise exception 'invalid_review_request' using errcode = '22023';
  end if;

  select count(*), count(distinct x.id),
    count(*) filter (where x.id is null or x.version is null or x.version < 0)
    into v_total, v_distinct, v_invalid
  from jsonb_to_recordset(p_rows) as x(id uuid, version bigint);
  if v_invalid > 0 or v_distinct <> v_total then
    raise exception 'invalid_review_request' using errcode = '22023';
  end if;

  if p_action = 'reopen' then
    select j.review_queue_size into v_queue_limit from public.jobs j
      where j.id = p_job_id for no key update;
    if not found then return 'missing'; end if;
  end if;

  -- Lock in UUID order. Validate every row before writing any of them.
  for v_row in
    select o.* from public.opportunities o
    where o.job_id = p_job_id and o.id in
      (select x.id from jsonb_to_recordset(p_rows) as x(id uuid))
    order by o.id for update
  loop
    v_found := v_found + 1;
    if v_row.queue_group = 'auto_filtered'
      and not public.has_permission('results.view_filtered') then
      return 'missing';
    end if;
    select x.version into v_version
      from jsonb_to_recordset(p_rows) as x(id uuid, version bigint)
      where x.id = v_row.id;
    if v_version <> v_row.row_version then return 'stale'; end if;
    if (p_action = 'claim' and v_row.review_status <> 'new')
      or (p_action in ('approve', 'reject') and v_row.review_status <> 'in_review')
      or (p_action = 'used' and v_row.review_status <> 'approved')
      or (p_action = 'reopen' and v_row.review_status not in ('approved', 'rejected', 'used')) then
      return 'invalid_state';
    end if;
    if p_action = 'reject' and length(btrim(coalesce(p_note, ''))) > 0 then
      v_notes := concat_ws(E'\n', nullif(v_row.notes, ''), btrim(p_note));
      if char_length(v_notes) > 4000 then
        raise exception 'review_note_too_long' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_found <> v_total then return 'missing'; end if;
  if p_action = 'reopen' and v_row.queue_group = 'ready' and
    (select count(*) from public.opportunities o where o.job_id = p_job_id
      and o.queue_group = 'ready' and o.review_status in ('new','in_review')) >= v_queue_limit then
    return 'queue_full';
  end if;

  for v_row in
    select o.* from public.opportunities o
    where o.job_id = p_job_id and o.id in
      (select x.id from jsonb_to_recordset(p_rows) as x(id uuid))
    order by o.id for update
  loop
    update public.opportunities set
      review_status = case p_action
        when 'claim' then 'in_review'::public.opportunity_review_status
        when 'approve' then 'approved'::public.opportunity_review_status
        when 'reject' then 'rejected'::public.opportunity_review_status
        when 'used' then 'used'::public.opportunity_review_status
        else 'in_review'::public.opportunity_review_status end,
      reviewer_id = auth.uid(),
      notes = case when p_action = 'reject' and length(btrim(coalesce(p_note, ''))) > 0
        then concat_ws(E'\n', nullif(v_row.notes, ''), btrim(p_note)) else v_row.notes end,
      reject_reason = case when p_action = 'reject'
        then p_reason::public.opportunity_reject_reason else null end,
      reject_scope = case
        when p_action <> 'reject' then null
        when p_reason = 'spam' then 'global'::public.opportunity_reject_scope
        when p_reason = 'off_topic' then 'niche'::public.opportunity_reject_scope
        else 'job'::public.opportunity_reject_scope end
    where id = v_row.id;
  end loop;
  return 'saved';
end;
$$;
