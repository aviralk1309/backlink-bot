begin;
select plan(7);

select has_table('public', 'csv_storage_cleanup', 'CSV cleanup queue exists');
select has_trigger('public', 'csv_uploads', 'csv_uploads_queue_storage_cleanup',
  'upload deletion queues Storage cleanup');
select ok(not has_table_privilege('authenticated', 'public.csv_storage_cleanup', 'DELETE'),
  'browser cannot discard cleanup targets');
select ok(has_table_privilege('worker', 'public.csv_storage_cleanup', 'DELETE'),
  'worker can acknowledge cleanup');
select ok(has_table_privilege('service_role', 'public.csv_storage_cleanup', 'DELETE'),
  'server action can acknowledge successful immediate cleanup');

insert into public.jobs (id, name, status)
values ('e3000000-0000-0000-0000-000000000001', 'CSV cleanup test', 'draft');
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, error_report_path)
values
  ('e3000000-0000-0000-0000-000000000002',
   'e3000000-0000-0000-0000-000000000001',
   'client', 'test.csv', 'e3/test.csv', 10, 'uploaded', 'e3/test_errors.csv');
delete from public.csv_uploads where id = 'e3000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::integer from public.csv_storage_cleanup
   where upload_id = 'e3000000-0000-0000-0000-000000000002'),
  2, 'raw file and error report both have retry targets');

delete from public.jobs where id = 'e3000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.csv_storage_cleanup
   where job_id = 'e3000000-0000-0000-0000-000000000001'),
  2, 'cleanup targets survive parent job deletion');

select * from finish();
rollback;
