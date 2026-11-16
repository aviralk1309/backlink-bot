-- Readable explanations persist alongside stable reason codes; no rows removed.
alter table public.opportunities add column filter_detail text;

create function public.opportunities_filter_detail()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.queue_group is distinct from 'auto_filtered' then
    new.filter_detail := null;
  elsif new.filter_detail is null or btrim(new.filter_detail) = ''
    or (tg_op = 'UPDATE' and new.filter_reason is distinct from old.filter_reason
        and new.filter_detail is not distinct from old.filter_detail) then
    new.filter_detail := case new.filter_reason
      when 'blocklisted' then 'The domain is on the global blocklist.'
      when 'job_blocked_domain' then 'The domain is excluded by this job.'
      when 'previously_spam' then 'Previously marked as spam; this job skips those domains.'
      else 'Filtered: ' || replace(coalesce(new.filter_reason, 'unspecified'), '_', ' ')
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.opportunities_filter_detail()
  from public, anon, authenticated, service_role, worker;
create trigger opportunities_filter_detail before insert or update of queue_group, filter_reason, filter_detail
  on public.opportunities for each row execute function public.opportunities_filter_detail();
update public.opportunities set filter_detail = null where queue_group = 'auto_filtered';
alter table public.opportunities add constraint opportunities_filter_detail_valid check (
  filter_detail is null or char_length(btrim(filter_detail)) between 1 and 2000
);
alter table public.opportunities add constraint opportunities_filtered_has_detail check (
  queue_group is distinct from 'auto_filtered' or filter_detail is not null
);

create function public.worker_publish_check_filter(
  p_id uuid, p_worker text, p_attempt integer, p_config_version integer, p_results jsonb,
  p_check_key text, p_reason text, p_detail text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (p_reason is null and (p_check_key is not null or p_detail is not null))
    or (p_reason is not null and (p_check_key is null or p_detail is null or btrim(p_detail) = '')) then
    raise exception 'invalid_filter_decision' using errcode = '22023';
  end if;
  -- Reuse S3's row lock, ownership/attempt/config/expiry fence and atomic validation.
  if not public.worker_save_opportunity_checks(p_id,p_worker,p_attempt,p_config_version,p_results) then
    return false;
  end if;
  if p_reason is null then return true; end if;
  if not exists (
    select 1 from public.opportunity_checks c where c.opportunity_id=p_id
      and c.check_key=p_check_key and c.reason_code=p_reason and c.status='fail'
      and c.config_version=p_config_version
  ) then
    raise exception 'filter_requires_failed_check' using errcode = '22023';
  end if;
  -- The Python policy owns the allowlist. This worker-only persistence RPC
  -- verifies the decision references evidence from this very publication.
  update public.opportunities set queue_group='auto_filtered', filter_reason=p_reason,
    filter_detail=p_detail, check_status='done', check_reason=null,
    score=null, score_breakdown=null, tier=null, locked_by=null, lease_expires_at=null
    where id=p_id;
  return true;
end;
$$;
revoke all on function public.worker_publish_check_filter(uuid,text,integer,integer,jsonb,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_publish_check_filter(uuid,text,integer,integer,jsonb,text,text,text)
  to worker;
