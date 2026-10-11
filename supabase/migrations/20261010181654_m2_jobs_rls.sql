-- M2-S1 (part 2): privileges and RLS for the jobs tables.
--
-- Rules (same shape as M1):
--  * RLS is the real gate. Column grants are defense in depth.
--  * Clients can never write jobs.status, jobs.config_version,
--    job_events or job_config_history. Those move only through the SQL
--    functions in the next migration (security definer).
--  * jobs.view / create / edit / delete, activities.manage and
--    blocklist.manage come from the M1 permission catalog. No new
--    permission is needed for M2.

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on public.jobs from anon;
revoke all on public.activity_profiles from anon;
revoke all on public.job_config_history from anon;
revoke all on public.job_events from anon;
revoke all on public.blocklist from anon;

-- Start from nothing for signed-in users, then grant exactly what is used.
revoke all on public.jobs from authenticated;
revoke all on public.activity_profiles from authenticated;
revoke all on public.job_config_history from authenticated;
revoke all on public.job_events from authenticated;
revoke all on public.blocklist from authenticated;

-- jobs: every config column except status, config_version, created_by,
-- job_type, id and timestamps.
grant select on public.jobs to authenticated;
grant insert (
  name, client, client_domain, target_urls, business_type, sub_niche,
  activity_keys, country, language, regions, seed_keywords, brand_variants,
  competitor_domains, reference_sites, seed_list_urls,
  banned_categories, blocked_domains, require_language_region_match,
  budget_credits, pages_per_query, saturation_n, saturation_x,
  per_domain_cap, review_queue_size, skip_previously_spam_domains,
  scrape_credit_cap, local_business
) on public.jobs to authenticated;
grant update (
  name, client, client_domain, target_urls, business_type, sub_niche,
  activity_keys, country, language, regions, seed_keywords, brand_variants,
  competitor_domains, reference_sites, seed_list_urls,
  banned_categories, blocked_domains, require_language_region_match,
  budget_credits, pages_per_query, saturation_n, saturation_x,
  per_domain_cap, review_queue_size, skip_previously_spam_domains,
  scrape_credit_cap, local_business
) on public.jobs to authenticated;
grant delete on public.jobs to authenticated;

-- activity profiles: no delete (disable instead), key is immutable,
-- version is trigger-owned.
grant select on public.activity_profiles to authenticated;
grant insert (
  key, name, enabled, footprint_templates, page_type_signals,
  relevance_rule, scoring_weights, per_domain_cap, reviewer_fields
) on public.activity_profiles to authenticated;
grant update (
  name, enabled, footprint_templates, page_type_signals,
  relevance_rule, scoring_weights, per_domain_cap, reviewer_fields
) on public.activity_profiles to authenticated;

-- history and events are read-only for clients
grant select on public.job_config_history to authenticated;
grant select on public.job_events to authenticated;

-- blocklist: domain is immutable (remove and re-add instead)
grant select on public.blocklist to authenticated;
grant insert (domain, reason, source_job_id) on public.blocklist to authenticated;
grant update (reason) on public.blocklist to authenticated;
grant delete on public.blocklist to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.activity_profiles enable row level security;
alter table public.job_config_history enable row level security;
alter table public.job_events enable row level security;
alter table public.blocklist enable row level security;

-- jobs
create policy jobs_select on public.jobs
  for select to authenticated
  using (public.has_permission('jobs.view'));

create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (public.has_permission('jobs.create'));

create policy jobs_update on public.jobs
  for update to authenticated
  using (public.has_permission('jobs.edit'))
  with check (public.has_permission('jobs.edit'));

-- A job that workers may be touching cannot be deleted. Stop it first.
create policy jobs_delete on public.jobs
  for delete to authenticated
  using (
    public.has_permission('jobs.delete')
    and status not in ('queued', 'running')
  );

-- history and events: readable with jobs.view, writable by nobody here
create policy job_config_history_select on public.job_config_history
  for select to authenticated
  using (public.has_permission('jobs.view'));

create policy job_events_select on public.job_events
  for select to authenticated
  using (public.has_permission('jobs.view'));

-- activity profiles: any active user reads (the job form needs them)
create policy activity_profiles_select on public.activity_profiles
  for select to authenticated
  using (public.current_role_id() is not null);

create policy activity_profiles_insert on public.activity_profiles
  for insert to authenticated
  with check (public.has_permission('activities.manage'));

create policy activity_profiles_update on public.activity_profiles
  for update to authenticated
  using (public.has_permission('activities.manage'))
  with check (public.has_permission('activities.manage'));

-- blocklist: only people who manage it can see or change it
create policy blocklist_select on public.blocklist
  for select to authenticated
  using (public.has_permission('blocklist.manage'));

create policy blocklist_insert on public.blocklist
  for insert to authenticated
  with check (public.has_permission('blocklist.manage'));

create policy blocklist_update on public.blocklist
  for update to authenticated
  using (public.has_permission('blocklist.manage'))
  with check (public.has_permission('blocklist.manage'));

create policy blocklist_delete on public.blocklist
  for delete to authenticated
  using (public.has_permission('blocklist.manage'));