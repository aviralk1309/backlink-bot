begin;
select plan(7);

insert into auth.users (id, email)
values ('e3000000-0000-0000-0000-000000000001', 'csv-confirm-admin@test.local');
update public.profiles
set status = 'active', role_id = 'a0000000-0000-0000-0000-000000000001'
where id = 'e3000000-0000-0000-0000-000000000001';

insert into public.jobs (id, name)
values ('e3000000-0000-0000-0000-000000000002', 'CSV confirmation guard');

insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, invalid_rows, duplicate_rows
) values
  ('e3000000-0000-0000-0000-000000000003',
   'e3000000-0000-0000-0000-000000000002', 'competitor', 'invalid.test',
   'invalid.csv', 'e3000000-0000-0000-0000-000000000002/invalid.csv', 100,
   'ready', '{"url_index":0}'::jsonb, 2, 0, 2, 0),
  ('e3000000-0000-0000-0000-000000000004',
   'e3000000-0000-0000-0000-000000000002', 'competitor', 'duplicates.test',
   'duplicates.csv', 'e3000000-0000-0000-0000-000000000002/duplicates.csv', 100,
   'ready', '{"url_index":0}'::jsonb, 1, 1, 0, 1),
  ('e3000000-0000-0000-0000-000000000005',
   'e3000000-0000-0000-0000-000000000002', 'competitor', 'valid.test',
   'valid.csv', 'e3000000-0000-0000-0000-000000000002/valid.csv', 100,
   'ready', '{"url_index":0}'::jsonb, 2, 2, 0, 1);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select public.confirm_csv_upload('e3000000-0000-0000-0000-000000000003')$$,
  '55000', 'upload_no_usable_rows', 'zero-valid CSV cannot be confirmed');
select is((select status::text from public.csv_uploads
  where id = 'e3000000-0000-0000-0000-000000000003'),
  'ready', 'zero-valid CSV remains reviewable');
select throws_ok(
  $$select public.confirm_csv_upload('e3000000-0000-0000-0000-000000000004')$$,
  '55000', 'upload_no_usable_rows', 'all-duplicate CSV cannot be confirmed');
select is((select status::text from public.csv_uploads
  where id = 'e3000000-0000-0000-0000-000000000004'),
  'ready', 'all-duplicate CSV remains reviewable');
select lives_ok(
  $$select public.confirm_csv_upload('e3000000-0000-0000-0000-000000000005')$$,
  'a CSV with a nonduplicate valid row can be confirmed');
select is((select status::text from public.csv_uploads
  where id = 'e3000000-0000-0000-0000-000000000005'),
  'confirmed', 'usable CSV becomes confirmed');
select lives_ok(
  $$select public.confirm_csv_upload('e3000000-0000-0000-0000-000000000005')$$,
  'reconfirmation remains idempotent');

select * from finish();
rollback;
