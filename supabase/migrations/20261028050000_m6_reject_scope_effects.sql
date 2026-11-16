-- M6-S5: keep live rejection flags in sync with decisions, and mark future finds.
create function public.normalized_review_niche(p_value text)
returns text language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(coalesce(p_value, ''), '[[:space:]]+', ' ', 'g')));
$$;
revoke all on function public.normalized_review_niche(text)
  from public, anon, authenticated, service_role, worker;

-- One live row per off-topic decision preserves its niche if a job is edited later.
create table public.domain_niche_rejections (
  opportunity_id uuid primary key references public.opportunities(id) on delete cascade,
  domain text not null,
  business_type text not null,
  sub_niche text not null,
  flagged_at timestamptz not null default now()
);
create index domain_niche_rejections_lookup_idx
  on public.domain_niche_rejections(domain, business_type, sub_niche);
revoke all on public.domain_niche_rejections
  from public, anon, authenticated, service_role, worker;
alter table public.domain_niche_rejections enable row level security;

insert into public.domain_niche_rejections
  (opportunity_id, domain, business_type, sub_niche, flagged_at)
select o.id, o.domain, public.normalized_review_niche(j.business_type),
  public.normalized_review_niche(j.sub_niche), coalesce(o.reviewed_at, now())
from public.opportunities o join public.jobs j on j.id = o.job_id
where o.review_status = 'rejected' and o.reject_reason = 'off_topic';

insert into public.domains(registered_domain)
select distinct o.domain from public.opportunities o
where o.review_status = 'rejected' and o.reject_reason = 'spam'
on conflict do nothing;
update public.domains d set global_spam = true,
  global_spam_at = coalesce(d.global_spam_at, s.reviewed_at, now()),
  global_spam_by = s.reviewer_id, global_spam_job_id = s.job_id
from (
  select distinct on (o.domain) o.domain, o.reviewer_id, o.job_id, o.reviewed_at
  from public.opportunities o
  where o.review_status = 'rejected' and o.reject_reason = 'spam'
  order by o.domain, o.reviewed_at desc nulls last, o.id desc
) s where d.registered_domain = s.domain;

create index opportunities_active_spam_domain_idx
  on public.opportunities(domain, reviewed_at desc, id desc)
  where review_status = 'rejected' and reject_reason = 'spam';

create function public.opportunities_sync_rejection_flags()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_domain text;
  v_new_domain text;
  v_reviewer uuid;
  v_job uuid;
  v_spam_effect boolean;
begin
  v_new_domain := old.domain;
  v_spam_effect := old.review_status = 'rejected' and old.reject_reason = 'spam';
  if tg_op = 'UPDATE' then
    v_new_domain := new.domain;
    if old.review_status = 'rejected' and old.reject_reason = 'off_topic' then
      delete from public.domain_niche_rejections where opportunity_id = old.id;
    end if;
    if new.review_status = 'rejected' and new.reject_reason = 'off_topic' then
      insert into public.domain_niche_rejections
        (opportunity_id, domain, business_type, sub_niche)
      select new.id, new.domain, public.normalized_review_niche(j.business_type),
        public.normalized_review_niche(j.sub_niche)
      from public.jobs j where j.id = new.job_id;
    end if;
    v_spam_effect := v_spam_effect or
      (new.review_status = 'rejected' and new.reject_reason = 'spam');
  end if;

  if v_spam_effect then
    for v_domain in select distinct unnest(array[old.domain, v_new_domain]) order by 1 loop
      insert into public.domains(registered_domain) values (v_domain)
        on conflict do nothing;
      -- Serialize decisions on this domain before counting live spam rejects.
      perform 1 from public.domains where registered_domain = v_domain for update;
      select o.reviewer_id, o.job_id into v_reviewer, v_job
      from public.opportunities o
      where o.domain = v_domain and o.review_status = 'rejected'
        and o.reject_reason = 'spam'
      order by o.reviewed_at desc nulls last, o.id desc limit 1;
      update public.domains set
        global_spam = v_reviewer is not null,
        global_spam_at = case
          when v_reviewer is null then null
          when global_spam then global_spam_at
          else clock_timestamp() end,
        global_spam_by = v_reviewer,
        global_spam_job_id = v_job
      where registered_domain = v_domain;
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.opportunities_sync_rejection_flags()
  from public, anon, authenticated, service_role, worker;
create trigger opportunities_sync_rejection_flags
  after update of review_status, reject_reason, domain on public.opportunities
  for each row
  when (old.review_status is distinct from new.review_status
     or old.reject_reason is distinct from new.reject_reason
     or old.domain is distinct from new.domain)
  execute function public.opportunities_sync_rejection_flags();
create trigger opportunities_clear_spam_on_delete
  after delete on public.opportunities
  for each row
  when (old.review_status = 'rejected' and old.reject_reason = 'spam')
  execute function public.opportunities_sync_rejection_flags();

-- Discovery remains a snapshot: a later flag change never rewrites an old row.
create function public.opportunities_mark_off_topic_at_discovery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.jobs j
    join public.domain_niche_rejections n
      on n.domain = new.domain
     and n.business_type = public.normalized_review_niche(j.business_type)
     and n.sub_niche = public.normalized_review_niche(j.sub_niche)
    where j.id = new.job_id
  ) then
    new.flags := new.flags || '{"previously_off_topic":true}'::jsonb;
  end if;
  return new;
end;
$$;
revoke all on function public.opportunities_mark_off_topic_at_discovery()
  from public, anon, authenticated, service_role, worker;
create trigger opportunities_mark_off_topic_at_discovery
  before insert on public.opportunities
  for each row execute function public.opportunities_mark_off_topic_at_discovery();
