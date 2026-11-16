-- M6-S1: durable review state and an atomic, append-only audit trail.
create type public.opportunity_review_status as enum
  ('new', 'in_review', 'approved', 'rejected', 'used');
create type public.opportunity_reject_reason as enum
  ('spam', 'off_topic', 'no_link_option', 'already_have', 'other');
create type public.opportunity_reject_scope as enum ('job', 'niche', 'global');

alter table public.opportunities
  add column review_status public.opportunity_review_status not null default 'new',
  add column reviewer_id uuid,
  add column reviewed_at timestamptz,
  add column notes text,
  add column reject_reason public.opportunity_reject_reason,
  add column reject_scope public.opportunity_reject_scope,
  add column score_at_review numeric(5, 2),
  add column tier_at_review public.opportunity_tier,
  add column external_metrics jsonb not null default '{}'::jsonb,
  add column row_version bigint not null default 0,
  add constraint opportunities_review_version_nonnegative check (row_version >= 0),
  add constraint opportunities_review_notes_length
    check (notes is null or char_length(notes) <= 4000),
  add constraint opportunities_review_metrics_object
    check (jsonb_typeof(external_metrics) = 'object' and octet_length(external_metrics::text) <= 16384),
  add constraint opportunities_review_actor
    check (review_status = 'new' or reviewer_id is not null),
  add constraint opportunities_review_decision_time
    check ((review_status in ('approved', 'rejected', 'used')) = (reviewed_at is not null)),
  add constraint opportunities_review_rejection
    check (
      (review_status = 'rejected' and reject_reason is not null and reject_scope is not null
        and reject_scope = case reject_reason
          when 'spam' then 'global'::public.opportunity_reject_scope
          when 'off_topic' then 'niche'::public.opportunity_reject_scope
          else 'job'::public.opportunity_reject_scope end
        and (reject_reason <> 'other' or length(btrim(coalesce(notes, ''))) > 0))
      or (review_status <> 'rejected' and reject_reason is null and reject_scope is null)
    );

create table public.opportunity_reviews (
  id bigint generated always as identity primary key,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  from_status public.opportunity_review_status not null,
  to_status public.opportunity_review_status not null,
  reject_reason public.opportunity_reject_reason,
  reject_scope public.opportunity_reject_scope,
  reviewer_id uuid,
  notes text,
  external_metrics jsonb not null,
  score numeric(5, 2),
  tier public.opportunity_tier,
  config_version integer not null,
  queue_group public.opportunity_queue_group,
  source_summary jsonb not null,
  row_version bigint not null,
  at timestamptz not null
);
create index opportunity_reviews_opportunity_at_idx
  on public.opportunity_reviews(opportunity_id, at desc, id desc);

-- The app's review RPC in S4 will be the only client write path. This trigger
-- also covers privileged updates and rolls a review back if its audit insert fails.
create function public.opportunities_record_review()
returns trigger language plpgsql set search_path = '' as $$
declare v_at timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.review_status <> 'new' or new.reviewer_id is not null
      or new.reviewed_at is not null or new.notes is not null
      or new.reject_reason is not null or new.reject_scope is not null
      or new.score_at_review is not null or new.tier_at_review is not null
      or new.external_metrics <> '{}'::jsonb or new.row_version <> 0 then
      raise exception 'review_insert_must_be_new' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.row_version is distinct from old.row_version
    or new.reviewed_at is distinct from old.reviewed_at
    or new.score_at_review is distinct from old.score_at_review
    or new.tier_at_review is distinct from old.tier_at_review then
    raise exception 'review_snapshot_is_managed' using errcode = '23514';
  end if;
  if (new.review_status, new.reviewer_id, new.notes, new.reject_reason,
      new.reject_scope, new.external_metrics) is not distinct from
     (old.review_status, old.reviewer_id, old.notes, old.reject_reason,
      old.reject_scope, old.external_metrics) then
    return new;
  end if;
  if current_user in ('worker', 'service_role') then
    raise exception 'review_write_forbidden' using errcode = '42501';
  end if;

  v_at := clock_timestamp();
  new.row_version := old.row_version + 1;
  if new.review_status is distinct from old.review_status then
    if new.review_status in ('approved', 'rejected', 'used') then
      new.reviewed_at := v_at;
      new.score_at_review := new.score;
      new.tier_at_review := new.tier;
    else
      new.reviewed_at := null;
      new.score_at_review := null;
      new.tier_at_review := null;
    end if;
  end if;

  insert into public.opportunity_reviews (
    opportunity_id, from_status, to_status, reject_reason, reject_scope,
    reviewer_id, notes, external_metrics, score, tier, config_version,
    queue_group, source_summary, row_version, at
  ) values (
    new.id, old.review_status, new.review_status, new.reject_reason, new.reject_scope,
    new.reviewer_id, new.notes, new.external_metrics, new.score, new.tier,
    new.config_version, new.queue_group,
    jsonb_build_object(
      'first_source_type', new.first_source_type,
      'found_by_count', new.found_by_count,
      'activity_key', new.activity_key,
      'overlap_count', new.overlap_count,
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object('type', s.source_type, 'ref', s.source_ref)
                         order by s.source_type, s.source_ref)
        from public.opportunity_sources s where s.opportunity_id = new.id
      ), '[]'::jsonb)
    ), new.row_version, v_at
  );
  return new;
end;
$$;
revoke all on function public.opportunities_record_review()
  from public, anon, authenticated, service_role, worker;
create trigger opportunities_record_review
  before insert or update on public.opportunities
  for each row execute function public.opportunities_record_review();

-- History follows the parent row's results-view and filtered-row policies.
revoke all on public.opportunity_reviews from public, anon, authenticated, service_role, worker;
grant select on public.opportunity_reviews to authenticated;
alter table public.opportunity_reviews enable row level security;
create policy opportunity_reviews_select on public.opportunity_reviews
  for select to authenticated
  using (exists (
    select 1 from public.opportunities o where o.id = opportunity_id
  ));
