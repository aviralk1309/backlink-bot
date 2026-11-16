-- M4-S6: Domain-level gap calculation with overlap counting (G6, G10).
--
-- Design notes
--  * Gap domains = domains in confirmed competitor files,
--    MINUS domains in confirmed client files,
--    MINUS the client's own domain,
--    MINUS competitor domains (jobs.competitor_domains and upload labels),
--    MINUS reference sites (jobs.reference_sites).
--  * Overlap count (G10) = distinct confirmed competitor labels linking to the domain.
--  * If no confirmed client file exists: client_link_status = 'unknown'.
--  * If a confirmed client file exists: client_link_status = 'known_partial'.
--  * Pure and idempotent: does not modify opportunity tables (staging to opportunities
--    is M4-S7). Can be used for preview (M4-S8) and job execution.

-- ---------------------------------------------------------------------
-- get_job_gap_domains
-- ---------------------------------------------------------------------
create or replace function public.get_job_gap_domains(p_job_id uuid)
returns table (
  domain text,
  overlap_count integer,
  client_link_status text,
  competitor_labels text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_domain text;
  v_has_client_file boolean;
  v_client_status text;
  v_job_competitor_domains text[];
  v_job_reference_sites text[];
begin
  if current_user not in ('worker', 'postgres') and session_user not in ('worker', 'postgres') and not (public.has_permission('jobs.view') or public.has_permission('csv.upload')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- 1. Job details
  select
    lower(btrim(j.client_domain)),
    coalesce(j.competitor_domains, '{}'::text[]),
    coalesce(j.reference_sites, '{}'::text[])
  into v_client_domain, v_job_competitor_domains, v_job_reference_sites
  from public.jobs j
  where j.id = p_job_id;

  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;

  -- 2. Check if at least one confirmed client file exists
  select exists (
    select 1
    from public.csv_uploads u
    where u.job_id = p_job_id
      and u.kind = 'client'
      and u.status = 'confirmed'
  ) into v_has_client_file;

  v_client_status := case when v_has_client_file then 'known_partial' else 'unknown' end;

  -- 3. Calculate gap domains
  return query
  with
  -- Excluded: competitor labels from uploads
  upload_competitor_labels as (
    select distinct lower(btrim(u.competitor_label)) as d
    from public.csv_uploads u
    where u.job_id = p_job_id
      and u.kind = 'competitor'
      and u.status = 'confirmed'
      and u.competitor_label is not null
  ),
  -- Excluded: domains that link to the client in confirmed client CSVs
  client_file_domains as (
    select distinct lower(btrim(r.domain)) as d
    from public.csv_uploads u
    join public.csv_rows r on r.upload_id = u.id
    where u.job_id = p_job_id
      and u.kind = 'client'
      and u.status = 'confirmed'
      and r.is_valid
      and r.domain is not null
  ),
  -- Excluded: job settings (client_domain, competitor_domains, reference_sites)
  job_configured_exclusions as (
    select lower(btrim(v_client_domain)) as d where v_client_domain is not null and v_client_domain <> ''
    union
    select distinct lower(btrim(elem)) as d from unnest(v_job_competitor_domains) elem where elem is not null and elem <> ''
    union
    select distinct lower(btrim(elem)) as d from unnest(v_job_reference_sites) elem where elem is not null and elem <> ''
  ),
  all_exclusions as (
    select d from job_configured_exclusions
    union
    select d from upload_competitor_labels
    union
    select d from client_file_domains
  ),
  -- Competitor linking domains with their competitor labels
  competitor_links as (
    select distinct
      lower(btrim(r.domain)) as dom,
      lower(btrim(u.competitor_label)) as label
    from public.csv_uploads u
    join public.csv_rows r on r.upload_id = u.id
    where u.job_id = p_job_id
      and u.kind = 'competitor'
      and u.status = 'confirmed'
      and r.is_valid
      and r.domain is not null
      and u.competitor_label is not null
  )
  select
    cl.dom as domain,
    count(cl.label)::integer as overlap_count,
    v_client_status as client_link_status,
    array_agg(cl.label order by cl.label) as competitor_labels
  from competitor_links cl
  where cl.dom not in (select d from all_exclusions where d is not null and d <> '')
  group by cl.dom
  order by overlap_count desc, domain asc;
end;
$$;

revoke all on function public.get_job_gap_domains(uuid) from public, anon;
grant execute on function public.get_job_gap_domains(uuid) to authenticated, worker;

comment on function public.get_job_gap_domains(uuid) is
  'Computes the domain-level competitor gap with overlap counts for a job.';

-- ---------------------------------------------------------------------
-- get_job_gap_preview
-- ---------------------------------------------------------------------
create or replace function public.get_job_gap_preview(p_job_id uuid)
returns table (
  total_gap_domains integer,
  has_client_file boolean,
  client_link_status text,
  overlap_distribution jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_client boolean;
  v_status text;
  v_total integer := 0;
  v_dist jsonb := '{}'::jsonb;
begin
  if current_user not in ('worker', 'postgres') and session_user not in ('worker', 'postgres') and not (public.has_permission('jobs.view') or public.has_permission('csv.upload')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.csv_uploads u
    where u.job_id = p_job_id
      and u.kind = 'client'
      and u.status = 'confirmed'
  ) into v_has_client;

  v_status := case when v_has_client then 'known_partial' else 'unknown' end;

  with gap_data as (
    select overlap_count
    from public.get_job_gap_domains(p_job_id)
  ),
  dist_counts as (
    select
      overlap_count::text as k,
      count(*)::integer as v
    from gap_data
    group by overlap_count
  )
  select
    coalesce(sum(v), 0)::integer,
    coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  into v_total, v_dist
  from dist_counts;

  return query
  select v_total, v_has_client, v_status, v_dist;
end;
$$;

revoke all on function public.get_job_gap_preview(uuid) from public, anon;
grant execute on function public.get_job_gap_preview(uuid) to authenticated, worker;

comment on function public.get_job_gap_preview(uuid) is
  'Returns summary stats and overlap distribution for the pre-start gap preview.';
