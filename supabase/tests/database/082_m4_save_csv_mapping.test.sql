begin;
select plan(15);

-- Fixtures (postgres): a2 manager (csv.upload), a3 viewer (jobs.view only).
-- Jobs: D draft, R running.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a3';

insert into public.jobs (id, name) values
  ('80000000-0000-0000-0000-0000000000d1', 'M4 S4 draft'),
  ('80000000-0000-0000-0000-0000000000f1', 'M4 S4 running');
update public.jobs set status = 'running'
  where id = '80000000-0000-0000-0000-0000000000f1';

-- U1 uploaded (draft job), U2 mapped (draft), U3 processing (draft),
-- U4 ready (draft), U5 uploaded (running job)
insert into public.csv_uploads
  (id, job_id, kind, competitor_label, filename, storage_path, size_bytes)
values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000d1',
   'competitor', 'rival.com', 'rival.csv', 'p/sm1.csv', 1000);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)
values
  ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c2.csv', 'p/sm2.csv', 500, 'mapped', '{"url_index": 0}'::jsonb);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)
values
  ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c3.csv', 'p/sm3.csv', 500, 'processing', '{"url_index": 0}'::jsonb);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping,
   total_rows, valid_rows)
values
  ('81000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c4.csv', 'p/sm4.csv', 500, 'ready', '{"url_index": 0}'::jsonb, 1, 1);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes)
values
  ('81000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-0000000000f1',
   'client', 'c5.csv', 'p/sm5.csv', 500);

-- Template for template_id test
insert into public.mapping_templates (id, name, kind, mapping)
values
  ('82000000-0000-0000-0000-000000000001', 'Ahrefs competitor', 'competitor',
   '{"url_index": 1}'::jsonb);

-- ---------------------------------------------------------------------
-- A. Privilege checks (2)
-- ---------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'public.save_csv_mapping(uuid, jsonb, uuid)', 'execute'),
  'anon cannot run save_csv_mapping'
);

set local role authenticated;

-- viewer (claims still viewer)
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '{"url_index": 0}'::jsonb)$$,
  '42501', null,
  'viewer cannot save a mapping'
);

-- ---------------------------------------------------------------------
-- B. Happy paths (4)
-- ---------------------------------------------------------------------
-- manager
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);

-- uploaded -> mapped
select lives_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '{"url_index": 2, "url_column": "Target URL", "columns": []}'::jsonb)$$,
  'manager can map an uploaded file'
);
select is(
  (select status::text from public.csv_uploads
    where id = '81000000-0000-0000-0000-000000000001'),
  'mapped',
  'upload status moved to mapped'
);

-- re-map (mapped -> mapped)
select lives_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000002',
      '{"url_index": 3, "url_column": "Page URL"}'::jsonb,
      '82000000-0000-0000-0000-000000000001')$$,
  'manager can re-map an already-mapped file with a template'
);
select is(
  (select template_id from public.csv_uploads
    where id = '81000000-0000-0000-0000-000000000002'),
  '82000000-0000-0000-0000-000000000001'::uuid,
  'template_id is saved'
);

-- ---------------------------------------------------------------------
-- C. Status guards (3)
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000003',
      '{"url_index": 0}'::jsonb)$$,
  '55000', null,
  'cannot map a file that is processing'
);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000004',
      '{"url_index": 0}'::jsonb)$$,
  '55000', null,
  'cannot map a file that is ready'
);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000005',
      '{"url_index": 0}'::jsonb)$$,
  '55000', null,
  'cannot map a file on a non-draft job'
);

-- ---------------------------------------------------------------------
-- D. Validation guards (4)
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '"not an object"'::jsonb)$$,
  '22023', 'mapping_not_object',
  'mapping must be an object'
);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '{}'::jsonb)$$,
  '22023', 'mapping_missing_url_index',
  'mapping must have url_index'
);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '{"url_index": "abc"}'::jsonb)$$,
  '22023', 'mapping_missing_url_index',
  'url_index must be a number'
);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '{"url_index": -1}'::jsonb)$$,
  '22023', 'mapping_missing_url_index',
  'url_index must be non-negative'
);
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-000000000001',
      '{"url_index": 1.5}'::jsonb)$$,
  '22023', 'mapping_missing_url_index',
  'url_index must be an integer'
);

-- E. Unknown upload (1)
select throws_ok(
  $$select public.save_csv_mapping(
      '81000000-0000-0000-0000-0000000000ff',
      '{"url_index": 0}'::jsonb)$$,
  'P0002', 'upload_not_found',
  'unknown upload is reported'
);

select * from finish();
rollback;
