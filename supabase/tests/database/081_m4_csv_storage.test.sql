begin;
select plan(24);

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
  ('80000000-0000-0000-0000-0000000000d1', 'M4 S2 draft'),
  ('80000000-0000-0000-0000-0000000000f1', 'M4 S2 running');
update public.jobs set status = 'running'
  where id = '80000000-0000-0000-0000-0000000000f1';

-- U1 uploaded, U2 ready (with a staged row), U3 processing, U4 on running job
insert into public.csv_uploads
  (id, job_id, kind, competitor_label, filename, storage_path, size_bytes)
values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000d1',
   'competitor', 'rival.com', 'rival.csv', 'p/u1.csv', 1000);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping,
   total_rows, valid_rows)
values
  ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c2.csv', 'p/u2.csv', 500, 'ready', '{}'::jsonb, 1, 1);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)
values
  ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c3.csv', 'p/u3.csv', 500, 'processing', '{}'::jsonb);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes)
values
  ('81000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-0000000000f1',
   'client', 'c4.csv', 'p/u4.csv', 500);
insert into public.csv_rows
  (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('81000000-0000-0000-0000-000000000002', 1, 'http://a.com/x', 'https://a.com/x',
   'a.com', 'a.com', true);

-- ---------------------------------------------------------------------
-- A. Bucket (4)
-- ---------------------------------------------------------------------
select ok(
  exists (select 1 from storage.buckets where id = 'csv-uploads' and not public),
  'csv-uploads bucket exists and is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'csv-uploads'),
  104857600::bigint,
  'bucket limit is 100 MiB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'csv-uploads'),
  array['text/csv'],
  'bucket accepts text/csv only'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'csv_uploads_objects_%'
      and roles <> array['authenticated']::name[]
  ),
  'bucket policies apply to signed-in users only'
);

-- ---------------------------------------------------------------------
-- B. Objects (10)
-- ---------------------------------------------------------------------
set local role authenticated;

-- manager
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('csv-uploads',
      '80000000-0000-0000-0000-0000000000d1/90000000-0000-0000-0000-000000000001.csv')$$,
  'manager can upload to a draft job'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('csv-uploads',
      '80000000-0000-0000-0000-0000000000f1/90000000-0000-0000-0000-000000000002.csv')$$,
  '42501', null,
  'manager cannot upload to a job that left Draft'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('csv-uploads',
      '80000000-0000-0000-0000-0000000000d1/90000000-0000-0000-0000-000000000003.exe')$$,
  '42501', null,
  'only the .csv name is accepted'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('csv-uploads', 'loose-file.csv')$$,
  '42501', null,
  'a path outside <job>/<upload>.csv is refused'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('csv-uploads',
      '80000000-0000-0000-0000-0000000000aa/90000000-0000-0000-0000-000000000004.csv')$$,
  '42501', null,
  'a path for an unknown job is refused'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'csv-uploads'),
  1,
  'manager can read the object'
);
-- Storage blocks direct DELETE with a trigger (before RLS runs), so check the
-- policies instead: clients get insert and select only.
select is(
  (select array_agg(cmd order by cmd) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'csv_uploads_objects_%'),
  array['INSERT', 'SELECT']::text[],
  'clients get insert and select on csv-uploads, never update or delete'
);
select is_empty(
  $$update storage.objects set name = name || 'x' where bucket_id = 'csv-uploads' returning 1$$,
  'manager cannot rename or overwrite objects'
);

-- viewer
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('csv-uploads',
      '80000000-0000-0000-0000-0000000000d1/90000000-0000-0000-0000-000000000005.csv')$$,
  '42501', null,
  'viewer cannot upload'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'csv-uploads'),
  0,
  'viewer cannot read objects'
);

-- ---------------------------------------------------------------------
-- C. discard_csv_upload (10)
-- ---------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'public.discard_csv_upload(uuid)', 'execute'),
  'anon cannot run discard_csv_upload'
);

set local role authenticated;

-- viewer (claims still viewer)
select throws_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'viewer cannot discard'
);

-- manager
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select lives_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-000000000001')$$,
  'manager can discard an uploaded file'
);
select is(
  (select status::text from public.csv_uploads
    where id = '81000000-0000-0000-0000-000000000001'),
  'discarded',
  'the upload is now discarded'
);
select lives_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-000000000002')$$,
  'manager can discard a ready file'
);
select is(
  (select count(*)::int from public.csv_rows
    where upload_id = '81000000-0000-0000-0000-000000000002'),
  0,
  'discarding removes the staged rows'
);
select lives_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-000000000001')$$,
  'discarding twice is safe'
);
select throws_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-000000000003')$$,
  '55000', 'upload_processing',
  'a file being read by the worker cannot be discarded'
);
select throws_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-000000000004')$$,
  '55000', 'job_not_draft',
  'files of a job that left Draft cannot be discarded'
);
select throws_ok(
  $$select public.discard_csv_upload('81000000-0000-0000-0000-0000000000ff')$$,
  'P0002', 'upload_not_found',
  'an unknown upload is reported'
);

select * from finish();
rollback;