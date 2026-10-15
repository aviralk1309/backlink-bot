begin;
select plan(42);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
-- a1 admin, a2 manager (csv.upload, mapping_templates.manage, jobs.view),
-- a3 viewer (jobs.view only)
-- Jobs: D draft, R running
-- Uploads on D: U1 competitor rival.com, U4 client already 'mapped'
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a3';

insert into public.jobs (id, name) values
  ('80000000-0000-0000-0000-0000000000d1', 'M4 S1 draft'),
  ('80000000-0000-0000-0000-0000000000f1', 'M4 S1 running');
update public.jobs set status = 'running'
  where id = '80000000-0000-0000-0000-0000000000f1';

insert into public.csv_uploads
  (id, job_id, kind, competitor_label, filename, storage_path, size_bytes)
values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000d1',
   'competitor', 'rival.com', 'rival.csv', 'job-d1/rival.csv', 1000);
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)
values
  ('81000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-0000000000d1',
   'client', 'client.csv', 'job-d1/client.csv', 500, 'mapped', '{}'::jsonb);

insert into public.csv_rows
  (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('81000000-0000-0000-0000-000000000001', 1, 'http://a.com/x', 'https://a.com/x',
   'a.com', 'a.com', true);

insert into public.mapping_templates (name, kind, mapping)
  values ('Ahrefs', 'competitor', '{}'::jsonb);

create function pg_temp.as_role(p_role text, p_sql text) returns text
language plpgsql
as $$
declare
  r text;
begin
  execute format('set local role %I', p_role);
  execute p_sql into r;
  reset role;
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- A. Privileges (10)
-- ---------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.csv_uploads', 'select'),
  'anon cannot read csv_uploads');
select ok(not has_table_privilege('anon', 'public.csv_rows', 'select'),
  'anon cannot read csv_rows');
select ok(not has_table_privilege('anon', 'public.mapping_templates', 'select'),
  'anon cannot read mapping_templates');
select ok(not has_column_privilege('authenticated', 'public.csv_uploads', 'status', 'update'),
  'signed-in users cannot update csv_uploads.status');
select ok(not has_column_privilege('authenticated', 'public.csv_uploads', 'total_rows', 'update'),
  'signed-in users cannot update csv_uploads counts');
select ok(not has_column_privilege('authenticated', 'public.csv_uploads', 'status', 'insert'),
  'signed-in users cannot pick a status on insert');
select ok(not has_table_privilege('authenticated', 'public.csv_uploads', 'delete'),
  'signed-in users cannot delete uploads');
select ok(
  not (has_table_privilege('authenticated', 'public.csv_rows', 'insert')
    or has_table_privilege('authenticated', 'public.csv_rows', 'update')
    or has_table_privilege('authenticated', 'public.csv_rows', 'delete')),
  'signed-in users cannot write staged rows');
select ok(
  not exists (
    select 1
    from unnest(array['csv_uploads', 'csv_rows', 'mapping_templates']) as t
    where not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)
  ),
  'row level security is on for every M4 table');
select ok(
  has_table_privilege('worker', 'public.csv_rows', 'insert')
  and has_table_privilege('worker', 'public.csv_rows', 'delete')
  and has_table_privilege('worker', 'public.csv_uploads', 'update')
  and not has_table_privilege('worker', 'public.csv_uploads', 'delete')
  and not has_table_privilege('worker', 'public.csv_uploads', 'insert'),
  'worker stages rows and updates uploads, but cannot create or delete uploads');

-- ---------------------------------------------------------------------
-- B. Constraints (14), as postgres
-- ---------------------------------------------------------------------
select throws_like(
  $$insert into public.csv_uploads (job_id, kind, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'competitor', 'f.csv', 'p/b1.csv', 10)$$,
  '%csv_uploads_label_by_kind%',
  'a competitor upload needs a label'
);
select throws_like(
  $$insert into public.csv_uploads
      (job_id, kind, competitor_label, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'client', 'x.com', 'f.csv', 'p/b2.csv', 10)$$,
  '%csv_uploads_label_by_kind%',
  'a client upload has no label'
);
select throws_like(
  $$insert into public.csv_uploads
      (job_id, kind, competitor_label, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'competitor', 'Bad Label', 'f.csv', 'p/b3.csv', 10)$$,
  '%csv_uploads_label_format%',
  'a label must look like a registered domain'
);
select throws_like(
  $$insert into public.csv_uploads (job_id, kind, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'client', 'f.csv', 'p/b4.csv', 0)$$,
  '%csv_uploads_size_positive%',
  'an empty file size is refused'
);
select throws_like(
  $$insert into public.csv_uploads (job_id, kind, filename, storage_path, size_bytes, status)
    values ('80000000-0000-0000-0000-0000000000d1', 'client', 'f.csv', 'p/b5.csv', 10, 'mapped')$$,
  '%csv_uploads_mapped_has_mapping%',
  'a mapped upload must have a mapping'
);
select throws_like(
  $$insert into public.csv_uploads
      (job_id, kind, filename, storage_path, size_bytes, status, mapping,
       total_rows, valid_rows, invalid_rows, empty_rows)
    values ('80000000-0000-0000-0000-0000000000d1', 'client', 'f.csv', 'p/b6.csv', 10,
            'ready', '{}'::jsonb, 5, 1, 1, 1)$$,
  '%csv_uploads_counts_add_up%',
  'a ready upload must have total = valid + invalid + empty'
);
select throws_like(
  $$insert into public.csv_uploads
      (job_id, kind, competitor_label, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'competitor', 'rival.com', 'f.csv', 'p/b7.csv', 10)$$,
  '%csv_uploads_active_competitor_key%',
  'one active upload per competitor label in a job'
);
select lives_ok(
  $$update public.csv_uploads set status = 'discarded'
      where id = '81000000-0000-0000-0000-000000000001';
    insert into public.csv_uploads
      (id, job_id, kind, competitor_label, filename, storage_path, size_bytes)
    values ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-0000000000d1',
            'competitor', 'rival.com', 'rival2.csv', 'job-d1/rival2.csv', 1200)$$,
  'a discarded upload does not block a re-upload of the same label'
);
select throws_like(
  $$insert into public.csv_rows (upload_id, row_no, raw_url, is_valid)
    values ('81000000-0000-0000-0000-000000000002', 1, 'x', true)$$,
  '%csv_rows_valid_has_fields%',
  'a valid staged row carries its normalized URL and domain'
);
select throws_like(
  $$insert into public.csv_rows (upload_id, row_no, raw_url, is_valid)
    values ('81000000-0000-0000-0000-000000000002', 1, 'x', false)$$,
  '%csv_rows_invalid_has_error%',
  'an invalid staged row says why (I3)'
);
select throws_like(
  $$insert into public.csv_rows (upload_id, row_no, raw_url, is_valid, is_duplicate, error_code)
    values ('81000000-0000-0000-0000-000000000002', 1, 'x', false, true, 'bad_url')$$,
  '%csv_rows_duplicate_only_valid%',
  'only valid rows can be duplicates'
);
select throws_like(
  $$insert into public.csv_rows
      (upload_id, row_no, raw_url, normalized_url, is_valid, error_code)
    values ('81000000-0000-0000-0000-000000000002', 1, 'x', 'http://x.com/a', false, 'bad_url')$$,
  '%csv_rows_normalized_url_https%',
  'a staged normalized URL must be https'
);
select lives_ok(
  $$insert into public.csv_uploads
      (id, job_id, kind, filename, storage_path, size_bytes)
    values ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-0000000000d1',
            'client', 'c2.csv', 'job-d1/c2.csv', 10);
    insert into public.csv_rows (upload_id, row_no, raw_url, is_valid, error_code)
      values ('81000000-0000-0000-0000-000000000003', 1, '', false, 'empty_row');
    delete from public.csv_uploads where id = '81000000-0000-0000-0000-000000000003'$$,
  'an upload with staged rows can be deleted'
);
select is(
  (select count(*)::int from public.csv_rows
    where upload_id = '81000000-0000-0000-0000-000000000003'),
  0,
  'deleting an upload removes its staged rows'
);

-- ---------------------------------------------------------------------
-- C. Row level security (18)
-- ---------------------------------------------------------------------
set local role authenticated;

-- viewer
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is(
  (select count(*)::int from public.csv_uploads
    where job_id = '80000000-0000-0000-0000-0000000000d1'),
  3,
  'viewer sees upload summaries (jobs.view)'
);
select is(
  (select count(*)::int from public.csv_rows
    where upload_id = '81000000-0000-0000-0000-000000000001'),
  0,
  'viewer cannot see staged rows'
);
select throws_ok(
  $$insert into public.csv_uploads (job_id, kind, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'client', 'v.csv', 'p/v.csv', 10)$$,
  '42501', null,
  'viewer cannot upload'
);
select is(
  (select count(*)::int from public.mapping_templates),
  0,
  'viewer cannot see mapping templates'
);

-- manager
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select lives_ok(
  $$insert into public.csv_uploads (job_id, kind, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000d1', 'client', 'm.csv', 'job-d1/m.csv', 10)$$,
  'manager can upload to a draft job'
);
select throws_ok(
  $$insert into public.csv_uploads (job_id, kind, filename, storage_path, size_bytes)
    values ('80000000-0000-0000-0000-0000000000f1', 'client', 'm.csv', 'job-f1/m.csv', 10)$$,
  '42501', null,
  'manager cannot upload to a job that has left Draft'
);
select is(
  (select count(*)::int from public.csv_rows
    where upload_id = '81000000-0000-0000-0000-000000000001'),
  1,
  'manager sees staged rows (csv.upload)'
);
select lives_ok(
  $$update public.csv_uploads set mapping = '{"url_column": "URL"}'::jsonb
      where id = '81000000-0000-0000-0000-000000000002'$$,
  'manager can save a mapping before import'
);
select is(
  (select mapping ->> 'url_column' from public.csv_uploads
    where id = '81000000-0000-0000-0000-000000000002'),
  'URL',
  'the mapping was saved'
);
select throws_ok(
  $$update public.csv_uploads set status = 'confirmed'
      where id = '81000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'manager cannot set an upload status'
);
select is_empty(
  $$update public.csv_uploads set mapping = '{"url_column": "X"}'::jsonb
      where id = '81000000-0000-0000-0000-000000000004'
      returning 1$$,
  'manager cannot change the mapping once the upload is mapped (worker may claim it)'
);
select lives_ok(
  $$insert into public.mapping_templates (name, kind, mapping)
    values ('Semrush', 'competitor', '{}'::jsonb)$$,
  'manager can create a mapping template'
);
select is(
  (select count(*)::int from public.mapping_templates),
  2,
  'manager sees shared templates'
);
select throws_ok(
  $$delete from public.csv_uploads where id = '81000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'manager cannot delete an upload'
);

-- worker
reset role;
select is(
  pg_temp.as_role('worker',
    $q$update public.csv_uploads set status = 'processing'
         where id = '81000000-0000-0000-0000-000000000002' returning 'ok'$q$),
  'ok',
  'worker can move an upload to processing'
);
select is(
  pg_temp.as_role('worker',
    $q$insert into public.csv_rows
         (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
       values ('81000000-0000-0000-0000-000000000002', 1, 'http://b.com/y',
               'https://b.com/y', 'b.com', 'b.com', true)
       returning 'ok'$q$),
  'ok',
  'worker can stage rows'
);
select throws_like(
  $$select pg_temp.as_role('worker',
      $q$delete from public.csv_uploads
           where id = '81000000-0000-0000-0000-000000000002' returning 'x'$q$)$$,
  'permission denied for table csv_uploads%',
  'worker cannot delete uploads'
);
select is(
  pg_temp.as_role('worker', $q$select count(*)::text from public.mapping_templates$q$),
  '2',
  'worker can read mapping templates'
);

select * from finish();
rollback;