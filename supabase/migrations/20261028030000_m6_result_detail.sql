-- M6-S3: metadata edits share the review row lock and append-only audit trigger.
create or replace function public.save_opportunity_metadata(
  p_id uuid, p_row_version bigint, p_notes text, p_metrics jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_row public.opportunities;
  v_metrics jsonb;
  v_key text;
  v_value jsonb;
begin
  if not public.has_permission('results.review')
    or not public.has_permission('results.view') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_row_version is null or p_row_version < 0
    or p_metrics is null or jsonb_typeof(p_metrics) <> 'object'
    or octet_length(p_metrics::text) > 16384
    or (p_notes is not null and char_length(p_notes) > 4000) then
    raise exception 'invalid_review_metadata' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_metrics) loop
    if v_key !~ '^[a-z][a-z0-9_]{0,29}$'
      or jsonb_typeof(v_value) not in ('null', 'string', 'number')
      or (jsonb_typeof(v_value) = 'string' and char_length(v_value #>> '{}') > 2048)
      or (jsonb_typeof(v_value) = 'number' and
        (v_value::text::numeric < 0 or v_value::text::numeric >
          case when v_key = 'dr' then 100 else 1000000000 end)) then
      raise exception 'invalid_review_metadata' using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.opportunities where id = p_id for update;
  if not found or (v_row.queue_group = 'auto_filtered'
      and not public.has_permission('results.view_filtered')) then
    return 'missing';
  end if;
  if v_row.row_version <> p_row_version then return 'stale'; end if;

  v_metrics := jsonb_strip_nulls(v_row.external_metrics || p_metrics);
  if octet_length(v_metrics::text) > 16384 then
    raise exception 'invalid_review_metadata' using errcode = '22023';
  end if;
  if (v_row.notes, v_row.external_metrics) is distinct from (p_notes, v_metrics) then
    update public.opportunities
      set notes = p_notes, external_metrics = v_metrics, reviewer_id = auth.uid()
      where id = p_id;
  end if;
  return 'saved';
end;
$$;
revoke all on function public.save_opportunity_metadata(uuid,bigint,text,jsonb)
  from public, anon, authenticated, service_role, worker;
grant execute on function public.save_opportunity_metadata(uuid,bigint,text,jsonb)
  to authenticated;
