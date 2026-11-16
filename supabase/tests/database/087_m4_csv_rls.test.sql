begin;
select plan(25);

-- ---------------------------------------------------------------------
-- Fixtures
-- a1: admin
-- a2: manager (has csv.upload, jobs.view, jobs.manage)
-- a3: viewer (has jobs.view only, no csv.upload)
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'admin_rls@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'manager_rls@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'viewer_rls@test.local')
on conflict (id) do nothing;

insert into public.profiles (id, email, status, role_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'admin_rls@test.local', 'active', 'a0000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b2', 'manager_rls@test.local', 'active', 'a0000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000b3', 'viewer_rls@test.local', 'active', 'a0000000-0000-0000-0000-000000000003')
on conflict (id) do update set status = 'active', role_id = excluded.role_id;

insert into public.jobs (id, name, status, client_domain) values
  ('80000000-0000-0000-0000-0000000000d3', 'M4 RLS draft', 'draft', 'client.com'),
  ('80000000-0000-0000-0000-0000000000f3', 'M4 RLS running', 'running', 'client.com')
on conflict (id) do nothing;

insert into public.csv_uploads
  (id, job_id, kind, competitor_label, filename, storage_path, size_bytes, status, mapping, confirmed_at)
values
  ('81000000-0000-0000-0000-000000000021', '80000000-0000-0000-0000-0000000000d3',
   'competitor', 'rival-rls.com', 'rival.csv', 'p/rls1.csv', 1000, 'ready', '{"url_index": 0}'::jsonb, null),
  ('81000000-0000-0000-0000-000000000022', '80000000-0000-0000-0000-0000000000f3',
   'competitor', 'rival-f3.com', 'rival.csv', 'p/rls2.csv', 1000, 'confirmed', '{"url_index": 0}'::jsonb, now())
on conflict (id) do nothing;

insert into public.csv_rows
  (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid, error_code)
values
  ('81000000-0000-0000-0000-000000000021', 1, 'https://example.com/valid', 'https://example.com/valid', 'example.com', 'example.com', true, null),
  ('81000000-0000-0000-0000-000000000021', 2, 'ftp://example.com/bad', null, null, null, false, 'unsupported_protocol');

-- Helper to run SQL as a given user id
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', p_uid::text);
  execute p_sql into v;
  reset role;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Anonymous user restrictions (7)
-- ---------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.csv_uploads', 'select'), 'anon cannot select csv_uploads');
select ok(not has_table_privilege('anon', 'public.csv_rows', 'select'), 'anon cannot select csv_rows');
select ok(not has_table_privilege('anon', 'public.mapping_templates', 'select'), 'anon cannot select mapping_templates');
select ok(not has_function_privilege('anon', 'public.get_csv_upload_error_counts(uuid)', 'execute'), 'anon cannot call get_csv_upload_error_counts');
select ok(not has_function_privilege('anon', 'public.delete_csv_upload(uuid)', 'execute'), 'anon cannot call delete_csv_upload');
select ok(not has_function_privilege('anon', 'public.import_job_gap_opportunities(uuid)', 'execute'), 'anon cannot call import_job_gap_opportunities');
select ok(not has_function_privilege('anon', 'public.import_job_seed_opportunities(uuid, jsonb)', 'execute'), 'anon cannot call import_job_seed_opportunities');

-- ---------------------------------------------------------------------
-- 2. Viewer role restrictions (jobs.view only) (7)
-- ---------------------------------------------------------------------
select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select count(*)::text from public.csv_uploads where job_id = '80000000-0000-0000-0000-0000000000d3'$q$
  ),
  '1',
  'viewer can view upload summaries for job'
);

select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select count(*)::text from public.csv_rows where upload_id = '81000000-0000-0000-0000-000000000021'$q$
  ),
  '0',
  'viewer cannot select staged raw csv_rows'
);

select throws_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000021'::uuid)$q$
  )$$,
  '42501', null,
  'viewer cannot call delete_csv_upload (permission denied)'
);

select throws_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select * from public.get_csv_upload_error_counts('81000000-0000-0000-0000-000000000021'::uuid)$q$
  )$$,
  '42501', null,
  'viewer cannot call get_csv_upload_error_counts (permission denied)'
);

select throws_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select public.save_csv_mapping('81000000-0000-0000-0000-000000000021'::uuid, '{"url_index": 0}'::jsonb)$q$
  )$$,
  '42501', null,
  'viewer cannot call save_csv_mapping (permission denied)'
);

select throws_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select public.import_job_gap_opportunities('80000000-0000-0000-0000-0000000000d3'::uuid)$q$
  )$$,
  '42501', null,
  'viewer cannot call import_job_gap_opportunities (worker only)'
);

select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000b3',
    $q$select count(*)::text from public.mapping_templates$q$
  ),
  '0',
  'viewer cannot view mapping_templates'
);

-- ---------------------------------------------------------------------
-- 3. Manager role permissions (csv.upload) (7)
-- ---------------------------------------------------------------------
select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select count(*)::text from public.csv_rows where upload_id = '81000000-0000-0000-0000-000000000021'$q$
  ),
  '2',
  'manager can view raw csv_rows'
);

select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select count(*)::text from public.get_csv_upload_error_counts('81000000-0000-0000-0000-000000000021'::uuid)$q$
  ),
  '1',
  'manager can call get_csv_upload_error_counts'
);

select lives_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select total_gap_domains from public.get_job_gap_preview('80000000-0000-0000-0000-0000000000d3'::uuid)$q$
  )$$,
  'manager can call get_job_gap_preview'
);

select lives_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select domain from public.get_job_gap_domains('80000000-0000-0000-0000-0000000000d3'::uuid)$q$
  )$$,
  'manager can call get_job_gap_domains'
);

select throws_like(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000022'::uuid)$q$
  )$$,
  '%job_not_draft%',
  'manager cannot delete upload once job has left draft'
);

select throws_ok(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select public.import_job_gap_opportunities('80000000-0000-0000-0000-0000000000d3'::uuid)$q$
  )$$,
  '42501', null,
  'manager cannot call import_job_gap_opportunities directly (worker only)'
);

select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000b2',
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000021'::uuid)$q$
  ),
  'p/rls1.csv',
  'manager can delete upload in draft job'
);

-- ---------------------------------------------------------------------
-- 4. Worker role execution (4)
-- ---------------------------------------------------------------------
create function pg_temp.as_worker(p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  execute 'set local role worker';
  execute p_sql into v;
  reset role;
  return v;
end;
$$;

select lives_ok(
  $$select pg_temp.as_worker(
    $q$select public.import_job_gap_opportunities('80000000-0000-0000-0000-0000000000f3'::uuid)$q$
  )$$,
  'worker can invoke import_job_gap_opportunities'
);

select lives_ok(
  $$select pg_temp.as_worker(
    $q$select public.import_job_seed_opportunities('80000000-0000-0000-0000-0000000000f3'::uuid, '[]'::jsonb)$q$
  )$$,
  'worker can invoke import_job_seed_opportunities'
);

select throws_like(
  $$select pg_temp.as_worker(
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000022'::uuid)$q$
  )$$,
  '%permission denied%',
  'worker cannot delete uploads'
);

select is(
  pg_temp.as_worker($q$select count(*)::text from public.jobs where id = '80000000-0000-0000-0000-0000000000f3'$q$),
  '1',
  'worker can read jobs'
);

select * from finish();
rollback;
