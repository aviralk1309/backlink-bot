-- A confirmed competitor CSV with usable rows is a discovery source.
-- Rollback: replace this function with its prior M2 definition; no data changes.
create or replace function public.job_start_problems(p_job_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  j public.jobs;
  v text[] := '{}';
begin
  select * into j from public.jobs where id = p_job_id;
  if not found then
    raise exception 'job_not_found';
  end if;

  if coalesce(btrim(j.client_domain), '') = '' then
    v := array_append(v, 'missing_client_domain');
  end if;
  if coalesce(btrim(j.business_type), '') = '' then
    v := array_append(v, 'missing_business_type');
  end if;
  if j.country is null then
    v := array_append(v, 'missing_country');
  end if;
  if j.language is null then
    v := array_append(v, 'missing_language');
  end if;
  if cardinality(j.seed_keywords) = 0 then
    v := array_append(v, 'missing_seed_keywords');
  end if;

  if cardinality(j.activity_keys) = 0 then
    v := array_append(v, 'no_activity');
  else
    if exists (
      select 1 from unnest(j.activity_keys) as k
      where not exists (select 1 from public.activity_profiles a where a.key = k)
    ) then
      v := array_append(v, 'activity_unknown');
    end if;
    if exists (
      select 1
      from unnest(j.activity_keys) as k
      join public.activity_profiles a on a.key = k
      where not a.enabled
    ) then
      v := array_append(v, 'activity_disabled');
    end if;
  end if;

  if not (
    j.budget_credits > 0
    or cardinality(j.seed_list_urls) > 0
    or cardinality(j.competitor_domains) > 0
    or exists (
      select 1
      from public.csv_uploads u
      where u.job_id = p_job_id
        and u.kind = 'competitor'
        and u.status = 'confirmed'
        and u.valid_rows > u.duplicate_rows
    )
  ) then
    v := array_append(v, 'no_source');
  end if;

  return v;
end;
$$;
