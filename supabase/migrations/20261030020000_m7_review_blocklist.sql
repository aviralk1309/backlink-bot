-- M7-S3: keep the rejected-row check and global block insert in one transaction.
create function public.block_rejected_domain(
  p_job_id uuid, p_result_id uuid, p_domain text, p_reason text
) returns table (outcome text, entry_id uuid, blocked_domain text)
language plpgsql security definer set search_path = '' as $$
declare v_row record; v_id uuid;
begin
  if not public.has_permission('jobs.view')
    or not public.has_permission('results.view')
    or not public.has_permission('blocklist.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_job_id is null or (p_result_id is null) = (p_domain is null)
    or p_reason is null or length(btrim(p_reason)) not between 1 and 200
    or (p_domain is not null and
      (length(p_domain) > 253 or p_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$')) then
    raise exception 'invalid_block_request' using errcode = '22023';
  end if;

  select o.id, o.domain into v_row
  from public.opportunities o
  where o.job_id = p_job_id and o.review_status = 'rejected'
    and (p_result_id is null or o.id = p_result_id)
    and (p_domain is null or o.domain = p_domain)
    and (o.queue_group is distinct from 'auto_filtered'
      or public.has_permission('results.view_filtered'))
  order by o.id limit 1 for update;
  if not found then
    return query select 'not_rejected'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.blocklist(domain, reason, source_job_id)
    values(v_row.domain, btrim(p_reason), p_job_id)
    on conflict (domain) do nothing returning id into v_id;
  return query select case when v_id is null then 'already_blocked'::text
    else 'added'::text end, v_id, v_row.domain;
end;
$$;
revoke all on function public.block_rejected_domain(uuid,uuid,text,text)
  from public,anon,service_role,worker;
grant execute on function public.block_rejected_domain(uuid,uuid,text,text)
  to authenticated;
