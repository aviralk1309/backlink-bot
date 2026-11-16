begin;
select plan(24);

-- Fixture: admin user for job creation
insert into auth.users (id, email)
values ('11111111-0000-0000-0000-000000000001', 'admin@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, email, role_id)
values (
  '11111111-0000-0000-0000-000000000001',
  'admin@example.com',
  'a0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Job 1: Job with client, competitor and reference domains
-- ---------------------------------------------------------------------
insert into public.jobs (
  id, name, client_domain, competitor_domains, reference_sites,
  seed_keywords, activity_keys, budget_credits, created_by, status
) values (
  '90000000-0000-0000-0000-000000000001',
  'M4-S7 Import Test Job',
  'myclient.com',
  array['rival1.com', 'rival2.com'],
  array['refsite.org'],
  array['keyword1'],
  array['guest_post'],
  100,
  '11111111-0000-0000-0000-000000000001',
  'running'
);

-- Competitor 1 upload (confirmed, label rival1.com)
insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, invalid_rows, empty_rows, duplicate_rows, confirmed_at
) values (
  '91000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  'competitor',
  'rival1.com',
  'comp1.csv',
  'jobs/90000000-0000-0000-0000-000000000001/comp1.csv',
  1024,
  'confirmed',
  '{"url_index": 0}'::jsonb,
  4, 4, 0, 0, 0,
  now()
);

-- Competitor 2 upload (confirmed, label rival2.com)
insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, invalid_rows, empty_rows, duplicate_rows, confirmed_at
) values (
  '91000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000001',
  'competitor',
  'rival2.com',
  'comp2.csv',
  'jobs/90000000-0000-0000-0000-000000000001/comp2.csv',
  1024,
  'confirmed',
  '{"url_index": 0}'::jsonb,
  3, 3, 0, 0, 0,
  now()
);

-- Client upload (confirmed) - excludes client-linked domains
insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, invalid_rows, empty_rows, duplicate_rows, confirmed_at
) values (
  '91000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001',
  'client',
  null,
  'client.csv',
  'jobs/90000000-0000-0000-0000-000000000001/client.csv',
  1024,
  'confirmed',
  '{"url_index": 0}'::jsonb,
  1, 1, 0, 0, 0,
  now()
);

-- Staged rows for Competitor 1:
-- 1. gap1.com/page1 (overlap: both comp1 and comp2)
-- 2. gap2.com/blog (overlap: only comp1)
-- 3. already-client.com/page (should be excluded by client file)
-- 4. myclient.com/page (should be excluded as client's own domain)
insert into public.csv_rows (
  upload_id, row_no, raw_url, normalized_url, host, domain, extras, is_valid, is_duplicate
) values
  ('91000000-0000-0000-0000-000000000001', 1, 'https://gap1.com/shared', 'https://gap1.com/shared', 'gap1.com', 'gap1.com', '{"anchor": "best tool"}'::jsonb, true, false),
  ('91000000-0000-0000-0000-000000000001', 2, 'https://gap2.com/blog', 'https://gap2.com/blog', 'gap2.com', 'gap2.com', '{"traffic": 500}'::jsonb, true, false),
  ('91000000-0000-0000-0000-000000000001', 3, 'https://already-client.com/p', 'https://already-client.com/p', 'already-client.com', 'already-client.com', '{}'::jsonb, true, false),
  ('91000000-0000-0000-0000-000000000001', 4, 'https://myclient.com/about', 'https://myclient.com/about', 'myclient.com', 'myclient.com', '{}'::jsonb, true, false);

-- Staged rows for Competitor 2:
-- 1. gap1.com/shared (duplicate of row 1 in comp1! different source_ref)
-- 2. gap1.com/other (another URL on gap1.com)
-- 3. refsite.org/links (should be excluded as reference site)
insert into public.csv_rows (
  upload_id, row_no, raw_url, normalized_url, host, domain, extras, is_valid, is_duplicate
) values
  ('91000000-0000-0000-0000-000000000002', 1, 'https://gap1.com/shared', 'https://gap1.com/shared', 'gap1.com', 'gap1.com', '{"score": 90}'::jsonb, true, false),
  ('91000000-0000-0000-0000-000000000002', 2, 'https://gap1.com/other', 'https://gap1.com/other', 'gap1.com', 'gap1.com', '{}'::jsonb, true, false),
  ('91000000-0000-0000-0000-000000000002', 3, 'https://refsite.org/links', 'https://refsite.org/links', 'refsite.org', 'refsite.org', '{}'::jsonb, true, false);

-- Client file staged rows
insert into public.csv_rows (
  upload_id, row_no, raw_url, normalized_url, host, domain, extras, is_valid, is_duplicate
) values
  ('91000000-0000-0000-0000-000000000003', 1, 'https://already-client.com/p', 'https://already-client.com/p', 'already-client.com', 'already-client.com', '{}'::jsonb, true, false);

-- ---------------------------------------------------------------------
-- Test 1-4: Run import_job_gap_opportunities
-- ---------------------------------------------------------------------
create function pg_temp.import_gap(p_job uuid)
returns text language sql as $$
  select concat_ws(',', total_candidates, opportunities_created, duplicates_skipped)
  from public.import_job_gap_opportunities(p_job);
$$;

select is(
  pg_temp.import_gap('90000000-0000-0000-0000-000000000001'),
  '4,3,1',
  'import gap: 4 candidate rows matching gap, 3 unique created, 1 duplicate skipped (gap1.com/shared)'
);

-- Check opportunities rows
select is(
  (select count(*)::int from public.opportunities where job_id = '90000000-0000-0000-0000-000000000001'),
  3,
  'exactly 3 opportunity rows created'
);

-- Check priority is 0 (gap runs first, I6)
select is(
  (select count(*)::int from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001' and priority = 0),
  3,
  'all gap opportunities have priority 0'
);

-- Check first_source_type is competitor_csv
select is(
  (select count(*)::int from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001' and first_source_type = 'competitor_csv'),
  3,
  'first_source_type is competitor_csv'
);

-- Check overlap_count and client_link_status for gap1.com/shared (overlap=2, client_link_status=known_partial)
select is(
  (select concat_ws(',', overlap_count, client_link_status, found_by_count)
     from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001'
      and normalized_url = 'https://gap1.com/shared'),
  '2,known_partial,2',
  'shared URL has overlap_count=2, known_partial, found_by_count=2'
);

-- Check extras merge on shared URL (both anchor and score present)
select ok(
  (select extras ? 'anchor' and extras ? 'score' and extras ? 'overlap_count'
     from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001'
      and normalized_url = 'https://gap1.com/shared'),
  'shared URL extras merged cleanly across competitor uploads'
);

-- Check gap2.com/blog (overlap=1, client_link_status=known_partial, found_by_count=1)
select is(
  (select concat_ws(',', overlap_count, client_link_status, found_by_count)
     from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001'
      and normalized_url = 'https://gap2.com/blog'),
  '1,known_partial,1',
  'single competitor URL has overlap_count=1, found_by_count=1'
);

-- Check sources recorded
select is(
  (select count(*)::int from public.opportunity_sources s
     join public.opportunities o on o.id = s.opportunity_id
    where o.job_id = '90000000-0000-0000-0000-000000000001'),
  4,
  '4 opportunity sources recorded (comp1 on shared, comp2 on shared, comp1 on blog, comp2 on other)'
);

-- Check job_stats live counters
select is(
  (select concat_ws(',', unique_opportunities, duplicates_skipped)
     from public.job_stats where job_id = '90000000-0000-0000-0000-000000000001'),
  '3,1',
  'job_stats: 3 unique opportunities, 1 duplicate skipped'
);

-- ---------------------------------------------------------------------
-- Test 10-12: Re-running import is idempotent
-- ---------------------------------------------------------------------
select is(
  pg_temp.import_gap('90000000-0000-0000-0000-000000000001'),
  '4,0,0',
  're-running gap import creates 0 new rows and 0 duplicates'
);

select is(
  (select count(*)::int from public.opportunities where job_id = '90000000-0000-0000-0000-000000000001'),
  3,
  'opportunities count is unchanged after re-run'
);

select is(
  (select concat_ws(',', unique_opportunities, duplicates_skipped)
     from public.job_stats where job_id = '90000000-0000-0000-0000-000000000001'),
  '3,1',
  'job_stats counters are unchanged after re-run'
);

-- ---------------------------------------------------------------------
-- Test 13-17: Seed list import
-- ---------------------------------------------------------------------
create function pg_temp.import_seeds(p_job uuid, p_seeds jsonb)
returns text language sql as $$
  select concat_ws(',', total_candidates, opportunities_created, duplicates_skipped)
  from public.import_job_seed_opportunities(p_job, p_seeds);
$$;

-- Seed list with 1 new URL and 1 duplicate of gap1.com/shared
select is(
  pg_temp.import_seeds(
    '90000000-0000-0000-0000-000000000001',
    '[
      {"original": "https://seed1.com/curated", "normalized": "https://seed1.com/curated", "host": "seed1.com", "domain": "seed1.com"},
      {"original": "https://gap1.com/shared", "normalized": "https://gap1.com/shared", "host": "gap1.com", "domain": "gap1.com"}
    ]'::jsonb
  ),
  '2,1,1',
  'seed list: 2 candidates, 1 created, 1 duplicate skipped'
);

select is(
  (select count(*)::int from public.opportunities where job_id = '90000000-0000-0000-0000-000000000001'),
  4,
  'now 4 total opportunities (3 gap + 1 seed)'
);

select is(
  (select priority from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001'
      and normalized_url = 'https://seed1.com/curated'),
  1::smallint,
  'seed-only opportunity has priority 1'
);

-- Gap opportunity that also appeared in seed list retains priority 0
select is(
  (select priority from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001'
      and normalized_url = 'https://gap1.com/shared'),
  0::smallint,
  'gap opportunity present in seed list retains lowest priority number 0 (I6)'
);

-- Check updated job_stats
select is(
  (select concat_ws(',', unique_opportunities, duplicates_skipped)
     from public.job_stats where job_id = '90000000-0000-0000-0000-000000000001'),
  '4,2',
  'job_stats: 4 unique opportunities, 2 duplicates skipped'
);

-- Re-running seed list import creates no duplicates
select is(
  pg_temp.import_seeds(
    '90000000-0000-0000-0000-000000000001',
    '[{"original": "https://seed1.com/curated", "normalized": "https://seed1.com/curated", "host": "seed1.com", "domain": "seed1.com"}]'::jsonb
  ),
  '1,0,0',
  're-running seed import is a no-op'
);

-- ---------------------------------------------------------------------
-- Test 19-21: Exclusions verified
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001' and domain = 'already-client.com'),
  0,
  'already-client.com was not imported (excluded by client file)'
);

select is(
  (select count(*)::int from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001' and domain = 'myclient.com'),
  0,
  'myclient.com was not imported (excluded as own domain)'
);

select is(
  (select count(*)::int from public.opportunities
    where job_id = '90000000-0000-0000-0000-000000000001' and domain = 'refsite.org'),
  0,
  'refsite.org was not imported (excluded as reference site)'
);

-- ---------------------------------------------------------------------
-- Test 22-24: Privileges
-- ---------------------------------------------------------------------
select ok(
  has_function_privilege('worker', 'public.import_job_gap_opportunities(uuid)', 'execute'),
  'worker can execute import_job_gap_opportunities'
);

select ok(
  has_function_privilege('worker', 'public.import_job_seed_opportunities(uuid, jsonb)', 'execute'),
  'worker can execute import_job_seed_opportunities'
);

select ok(
  not has_function_privilege('anon', 'public.import_job_gap_opportunities(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.import_job_gap_opportunities(uuid)', 'execute'),
  'anon and authenticated cannot execute import_job_gap_opportunities'
);

rollback;
