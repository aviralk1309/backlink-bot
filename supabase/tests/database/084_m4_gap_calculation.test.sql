begin;
select plan(16);

-- Fixtures: a2 manager (csv.upload, jobs.view), a3 viewer (jobs.view only), anon
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local')
on conflict (id) do nothing;

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a3';

-- Job 1: Has client domain, competitor domain, reference site
insert into public.jobs (
  id, name, status, client_domain, competitor_domains, reference_sites
) values (
  '84000000-0000-0000-0000-000000000001',
  'M4 Gap Job 1',
  'draft',
  'myclient.com',
  array['rival1.com', 'rival2.com'],
  array['wikipedia.org']
) on conflict (id) do update set
  client_domain = excluded.client_domain,
  competitor_domains = excluded.competitor_domains,
  reference_sites = excluded.reference_sites;

-- Job 2: Similar job but WITHOUT client CSV
insert into public.jobs (
  id, name, status, client_domain, competitor_domains, reference_sites
) values (
  '84000000-0000-0000-0000-000000000002',
  'M4 Gap Job 2',
  'draft',
  'myclient.com',
  array['rival1.com'],
  array[]::text[]
) on conflict (id) do update set
  client_domain = excluded.client_domain;

-- Uploads for Job 1:
-- U1: competitor 'rival1.com' (confirmed)
-- U2: competitor 'rival2.com' (confirmed)
-- U3: competitor 'rival3.com' (ready, NOT confirmed -> MUST NOT COUNT)
-- U4: client file (confirmed)
insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes, status, mapping, confirmed_at
) values
  ('84100000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001',
   'competitor', 'rival1.com', 'c1.csv', 'p/c1.csv', 100, 'confirmed', '{"url_index": 0}'::jsonb, now()),
  ('84100000-0000-0000-0000-000000000002', '84000000-0000-0000-0000-000000000001',
   'competitor', 'rival2.com', 'c2.csv', 'p/c2.csv', 100, 'confirmed', '{"url_index": 0}'::jsonb, now()),
  ('84100000-0000-0000-0000-000000000003', '84000000-0000-0000-0000-000000000001',
   'competitor', 'rival3.com', 'c3.csv', 'p/c3.csv', 100, 'ready', '{"url_index": 0}'::jsonb, null),
  ('84100000-0000-0000-0000-000000000004', '84000000-0000-0000-0000-000000000001',
   'client', null, 'client.csv', 'p/cl.csv', 100, 'confirmed', '{"url_index": 0}'::jsonb, now());

-- Uploads for Job 2:
-- U5: competitor 'rival1.com' (confirmed, no client upload)
insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes, status, mapping, confirmed_at
) values
  ('84100000-0000-0000-0000-000000000005', '84000000-0000-0000-0000-000000000002',
   'competitor', 'rival1.com', 'c1.csv', 'p/c1b.csv', 100, 'confirmed', '{"url_index": 0}'::jsonb, now());

-- Staged rows:
-- U1 (rival1.com):
--  - gap1.com (row 1, valid)
--  - sub.gap1.com -> domain: gap1.com (row 2, valid, same domain)
--  - overlap.com (row 3, valid)
--  - already-client.com (row 4, valid)
--  - myclient.com (row 5, valid -> MUST BE EXCLUDED by own-domain)
--  - rival2.com (row 6, valid -> MUST BE EXCLUDED by competitor domain)
--  - wikipedia.org (row 7, valid -> MUST BE EXCLUDED by reference site)
insert into public.csv_rows (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('84100000-0000-0000-0000-000000000001', 1, 'https://gap1.com/p1', 'https://gap1.com/p1', 'gap1.com', 'gap1.com', true),
  ('84100000-0000-0000-0000-000000000001', 2, 'https://blog.gap1.com/p2', 'https://blog.gap1.com/p2', 'blog.gap1.com', 'gap1.com', true),
  ('84100000-0000-0000-0000-000000000001', 3, 'https://overlap.com/a', 'https://overlap.com/a', 'overlap.com', 'overlap.com', true),
  ('84100000-0000-0000-0000-000000000001', 4, 'https://already-client.com/a', 'https://already-client.com/a', 'already-client.com', 'already-client.com', true),
  ('84100000-0000-0000-0000-000000000001', 5, 'https://blog.myclient.com/x', 'https://blog.myclient.com/x', 'blog.myclient.com', 'myclient.com', true),
  ('84100000-0000-0000-0000-000000000001', 6, 'https://rival2.com/about', 'https://rival2.com/about', 'rival2.com', 'rival2.com', true),
  ('84100000-0000-0000-0000-000000000001', 7, 'https://en.wikipedia.org/wiki/X', 'https://en.wikipedia.org/wiki/X', 'en.wikipedia.org', 'wikipedia.org', true);

-- U2 (rival2.com):
--  - overlap.com (row 1, valid -> should give overlap_count = 2)
--  - gap2.com (row 2, valid)
insert into public.csv_rows (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('84100000-0000-0000-0000-000000000002', 1, 'https://overlap.com/b', 'https://overlap.com/b', 'overlap.com', 'overlap.com', true),
  ('84100000-0000-0000-0000-000000000002', 2, 'https://gap2.com/p', 'https://gap2.com/p', 'gap2.com', 'gap2.com', true);

-- U3 (rival3.com - READY ONLY, not confirmed):
--  - unconfirmed-only.com (MUST NOT APPEAR in gap)
insert into public.csv_rows (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('84100000-0000-0000-0000-000000000003', 1, 'https://unconfirmed-only.com/p', 'https://unconfirmed-only.com/p', 'unconfirmed-only.com', 'unconfirmed-only.com', true);

-- U4 (Client file):
--  - already-client.com (subdomain links to client -> domain already-client.com must be excluded)
insert into public.csv_rows (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('84100000-0000-0000-0000-000000000004', 1, 'https://sub.already-client.com/link', 'https://sub.already-client.com/link', 'sub.already-client.com', 'already-client.com', true);

-- U5 (Job 2, competitor rival1.com, no client file):
--  - gap-no-client.com
insert into public.csv_rows (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('84100000-0000-0000-0000-000000000005', 1, 'https://gap-no-client.com/p', 'https://gap-no-client.com/p', 'gap-no-client.com', 'gap-no-client.com', true);

-- ---------------------------------------------------------------------
-- A. Privilege checks
-- ---------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'public.get_job_gap_domains(uuid)', 'execute'),
  'anon cannot run get_job_gap_domains'
);
select ok(
  not has_function_privilege('anon', 'public.get_job_gap_preview(uuid)', 'execute'),
  'anon cannot run get_job_gap_preview'
);
select ok(
  has_function_privilege('authenticated', 'public.get_job_gap_domains(uuid)', 'execute'),
  'authenticated can run get_job_gap_domains'
);
select ok(
  has_function_privilege('worker', 'public.get_job_gap_domains(uuid)', 'execute'),
  'worker can run get_job_gap_domains'
);

-- ---------------------------------------------------------------------
-- B. Gap domain calculation checks (Job 1: Client file present)
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);

-- 1. Total gap domains: gap1.com, gap2.com, overlap.com = 3 domains
select is(
  (select count(*)::int from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001')),
  3,
  'exactly 3 domains in the gap for Job 1'
);

-- 2. Overlap count for overlap.com should be 2
select is(
  (select overlap_count from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'overlap.com'),
  2,
  'overlap.com has overlap_count = 2 (rival1.com and rival2.com)'
);

-- 3. Overlap count for gap1.com should be 1 even with two rows (subdomain and root)
select is(
  (select overlap_count from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'gap1.com'),
  1,
  'gap1.com has overlap_count = 1 despite having multiple linking URLs from same competitor'
);

-- 4. Client file present sets client_link_status = 'known_partial'
select is(
  (select client_link_status from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') limit 1),
  'known_partial'::text,
  'client file present sets client_link_status = known_partial'
);

-- 5. Excluded domain checks
select ok(
  not exists (select 1 from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'already-client.com'),
  'already-client.com is excluded by client file'
);
select ok(
  not exists (select 1 from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'myclient.com'),
  'myclient.com is excluded as client own domain'
);
select ok(
  not exists (select 1 from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'rival2.com'),
  'rival2.com is excluded as competitor domain'
);
select ok(
  not exists (select 1 from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'wikipedia.org'),
  'wikipedia.org is excluded as reference site'
);
select ok(
  not exists (select 1 from public.get_job_gap_domains('84000000-0000-0000-0000-000000000001') where domain = 'unconfirmed-only.com'),
  'unconfirmed upload rows do not count towards the gap'
);

-- ---------------------------------------------------------------------
-- C. Gap domain calculation checks (Job 2: No client file)
-- ---------------------------------------------------------------------
select is(
  (select client_link_status from public.get_job_gap_domains('84000000-0000-0000-0000-000000000002')),
  'unknown'::text,
  'no client file sets client_link_status = unknown'
);

-- ---------------------------------------------------------------------
-- D. Gap preview checks
-- ---------------------------------------------------------------------
select is(
  (select total_gap_domains from public.get_job_gap_preview('84000000-0000-0000-0000-000000000001')),
  3,
  'preview reports total_gap_domains = 3'
);

select is(
  (select overlap_distribution from public.get_job_gap_preview('84000000-0000-0000-0000-000000000001')),
  '{"1": 2, "2": 1}'::jsonb,
  'preview reports correct overlap distribution (two with 1, one with 2)'
);

rollback;
