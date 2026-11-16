begin;
select plan(7);

-- Fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e2', 'manager_del@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'viewer_del@test.local')
on conflict (id) do nothing;

insert into public.profiles (id, email, status, role_id) values
  ('00000000-0000-0000-0000-0000000000e2', 'manager_del@test.local', 'active', 'a0000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000e3', 'viewer_del@test.local', 'active', 'a0000000-0000-0000-0000-000000000003')
on conflict (id) do update set status = 'active', role_id = excluded.role_id;

insert into public.jobs (id, name, status) values
  ('80000000-0000-0000-0000-0000000000d2', 'M4 Delete draft', 'draft'),
  ('80000000-0000-0000-0000-0000000000f2', 'M4 Delete running', 'running')
on conflict (id) do nothing;

insert into public.csv_uploads
  (id, job_id, kind, competitor_label, filename, storage_path, size_bytes, status, mapping, confirmed_at)
values
  ('81000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-0000000000d2',
   'competitor', 'rival-del.com', 'rival.csv', 'p/del1.csv', 1000, 'uploaded', null, null),
  ('81000000-0000-0000-0000-000000000012', '80000000-0000-0000-0000-0000000000d2',
   'competitor', 'rival-proc.com', 'proc.csv', 'p/del2.csv', 1000, 'processing', '{"url_index": 0}'::jsonb, null),
  ('81000000-0000-0000-0000-000000000013', '80000000-0000-0000-0000-0000000000f2',
   'competitor', 'rival-run.com', 'run.csv', 'p/del3.csv', 1000, 'confirmed', '{"url_index": 0}'::jsonb, now());

insert into public.csv_rows
  (upload_id, row_no, raw_url, normalized_url, host, domain, is_valid)
values
  ('81000000-0000-0000-0000-000000000011', 1, 'https://a.com/1', 'https://a.com/1', 'a.com', 'a.com', true);

-- Helper
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

-- Test 1: Manager can delete uploaded file
select is(
  pg_temp.as_user('00000000-0000-0000-0000-0000000000e2',
    $$select public.delete_csv_upload('81000000-0000-0000-0000-000000000011'::uuid)$$
  ),
  'p/del1.csv',
  'delete_csv_upload returns storage_path upon successful deletion'
);

-- Test 2: Upload is deleted from csv_uploads
select is(
  (select count(*)::int from public.csv_uploads where id = '81000000-0000-0000-0000-000000000011'),
  0,
  'upload row was deleted'
);

-- Test 3: csv_rows cascaded and deleted
select is(
  (select count(*)::int from public.csv_rows where upload_id = '81000000-0000-0000-0000-000000000011'),
  0,
  'csv_rows were cascade-deleted'
);

-- Test 4: Cannot delete processing upload
select throws_like(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2',
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000012'::uuid)$q$)$$,
  '%upload_processing%',
  'cannot delete upload currently in processing'
);

-- Test 5: Cannot delete upload on running job
select throws_like(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2',
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000013'::uuid)$q$)$$,
  '%job_not_draft%',
  'cannot delete upload on non-draft job'
);

-- Test 6: Viewer without csv.upload cannot delete
select throws_like(
  $$select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3',
    $q$select public.delete_csv_upload('81000000-0000-0000-0000-000000000012'::uuid)$q$)$$,
  '%permission denied%',
  'viewer without csv.upload cannot delete upload'
);

-- Test 7: Anonymous cannot execute
select ok(
  not has_function_privilege('anon', 'public.delete_csv_upload(uuid)', 'execute'),
  'anon cannot execute delete_csv_upload'
);

rollback;
