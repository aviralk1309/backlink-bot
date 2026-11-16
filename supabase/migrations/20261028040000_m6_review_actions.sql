-- M6-S4: decisions, soft claims, privileged reopen, and atomic bulk review.
insert into public.permissions (key, "group", description) values
  ('results.reopen', 'Results', 'Reopen decided results for another review')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key) values
  ('a0000000-0000-0000-0000-000000000001', 'results.reopen')
on conflict do nothing;

-- Expose only the name attached to a visible result, not the user directory.
create function public.result_review_state(p_ids uuid[])
returns table (id uuid, row_version bigint, reviewer_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('results.view') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) > 50 then
    raise exception 'invalid_results_request' using errcode = '22023';
  end if;
  return query
    select o.id, o.row_version,
      case when o.reviewer_id is null then null
           else coalesce(nullif(btrim(p.full_name), ''), 'Former reviewer') end
    from public.opportunities o
    left join public.profiles p on p.id = o.reviewer_id
    where o.id = any(p_ids)
      and (o.queue_group is distinct from 'auto_filtered'
           or public.has_permission('results.view_filtered'));
end;
$$;
revoke all on function public.result_review_state(uuid[])
  from public, anon, authenticated, service_role, worker;
grant execute on function public.result_review_state(uuid[]) to authenticated;

create function public.review_opportunities(
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
revoke all on function public.review_opportunities(uuid,jsonb,text,text,text)
  from public, anon, authenticated, service_role, worker;
grant execute on function public.review_opportunities(uuid,jsonb,text,text,text)
  to authenticated;
