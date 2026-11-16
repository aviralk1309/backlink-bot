-- Pin the activity check rules alongside job and scoring config. Live profile
-- edits must not silently change a running job's check semantics.
create function public.capture_activity_pipeline_profiles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.snapshot := new.snapshot || jsonb_build_object('activity_profiles', coalesce((
    select jsonb_object_agg(a.key,jsonb_build_object(
      'key',a.key,'version',a.version,'enabled',a.enabled,
      'page_type_signals',a.page_type_signals,'relevance_rule',a.relevance_rule
    ))
    from public.activity_profiles a
    where a.key in (select jsonb_array_elements_text(
      coalesce(new.snapshot->'activity_keys','[]'::jsonb)))
  ),'{}'::jsonb));
  return new;
end;
$$;
revoke all on function public.capture_activity_pipeline_profiles()
  from public,anon,authenticated,service_role,worker;
create trigger capture_activity_pipeline_profiles before insert on public.job_config_history
  for each row execute function public.capture_activity_pipeline_profiles();

-- Store compact fetch evidence under the same live claim before S6 filtering;
-- later check/score/queue work is in the same transaction as filter publication.
create function public.worker_save_fetch_summary(
  p_id uuid,p_worker text,p_attempt integer,p_config_version integer,p_summary jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_summary is null or jsonb_typeof(p_summary)<>'object'
    or octet_length(p_summary::text)>16384 then
    raise exception 'invalid_fetch_summary' using errcode='22023';
  end if;
  perform 1 from public.opportunities o where o.id=p_id and o.check_status='running'
    and o.locked_by=p_worker and o.attempts=p_attempt and o.config_version=p_config_version
    and o.lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  update public.opportunities set fetch_summary=p_summary where id=p_id;
  return true;
end;
$$;
revoke all on function public.worker_save_fetch_summary(uuid,text,integer,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.worker_save_fetch_summary(uuid,text,integer,integer,jsonb) to worker;
