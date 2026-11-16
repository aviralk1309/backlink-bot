-- M7-S4: freeze the feature vector used for each decision and reject unscored decisions.
alter table public.opportunity_reviews add column scoring_inputs jsonb;

create function public.guard_review_scoring_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.review_status is distinct from old.review_status
    and new.review_status in ('approved', 'rejected', 'used')
    and (new.score is distinct from old.score
      or new.score_breakdown is distinct from old.score_breakdown) then
    raise exception 'review_scoring_changed_with_decision' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_review_scoring_update()
  from public, anon, authenticated, service_role, worker;
create trigger a_opportunities_guard_review_scoring_update
  before update on public.opportunities
  for each row execute function public.guard_review_scoring_update();

create function public.capture_review_scoring_inputs()
returns trigger language plpgsql set search_path = '' as $$
declare v_breakdown jsonb; v_valid boolean;
begin
  if new.from_status = new.to_status
    or new.to_status not in ('approved', 'rejected', 'used') then
    return new;
  end if;

  -- The review update changes only review fields; the locked parent still holds
  -- the exact scoring payload until its BEFORE UPDATE trigger completes.
  select o.score_breakdown into v_breakdown
    from public.opportunities o where o.id = new.opportunity_id;
  if new.score is null
    or jsonb_typeof(v_breakdown->'algorithm_version') is distinct from 'number'
    or jsonb_typeof(v_breakdown->'scoring_config_version') is distinct from 'number'
    or jsonb_typeof(v_breakdown->'components') is distinct from 'array' then
    raise exception 'review_scoring_missing' using errcode = '23514';
  end if;
  select count(*) = 6 and count(distinct c->>'component') = 6
    and coalesce(bool_and(c->>'component' = any(array[
      'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty'
    ]) and jsonb_typeof(c->'raw') = 'number'), false)
    into v_valid
  from jsonb_array_elements(v_breakdown->'components') c;
  if not v_valid then
    raise exception 'review_scoring_missing' using errcode = '23514';
  end if;

  new.scoring_inputs := jsonb_build_object(
    'algorithm_version', v_breakdown->'algorithm_version',
    'scoring_config_version', v_breakdown->'scoring_config_version',
    'components', v_breakdown->'components',
    'unknown_checks', coalesce(v_breakdown->'unknown_checks', '[]'::jsonb)
  );
  return new;
end;
$$;
revoke all on function public.capture_review_scoring_inputs()
  from public, anon, authenticated, service_role, worker;
create trigger opportunity_reviews_capture_scoring_inputs
  before insert on public.opportunity_reviews
  for each row execute function public.capture_review_scoring_inputs();
