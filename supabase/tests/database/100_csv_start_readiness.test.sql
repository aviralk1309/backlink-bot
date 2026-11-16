begin;
select plan(9);

insert into auth.users (id, email)
values ('e1000000-0000-0000-0000-000000000001', 'csv-start-admin@test.local');
update public.profiles
set status = 'active', role_id = 'a0000000-0000-0000-0000-000000000001'
where id = 'e1000000-0000-0000-0000-000000000001';

insert into public.jobs (
  id, name, client_domain, business_type, country, language,
  seed_keywords, activity_keys, budget_credits
) values (
  'e1000000-0000-0000-0000-000000000002', 'CSV-only start readiness',
  'csv-client.example.com', 'Software', 'US', 'en',
  array['backlinks'], array['guest_post'], 0
);

select ok(
  'no_source' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002')),
  'a job without a source cannot start'
);

insert into public.csv_uploads (
  id, job_id, kind, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, confirmed_at
) values (
  'e1000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000002', 'client',
  'client.csv', 'e1000000-0000-0000-0000-000000000002/client.csv', 100,
  'confirmed', '{"url_index": 0}'::jsonb, 1, 1, now()
);

select ok(
  'no_source' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002')),
  'a confirmed client CSV is not a discovery source'
);

insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows
) values (
  'e1000000-0000-0000-0000-000000000004',
  'e1000000-0000-0000-0000-000000000002', 'competitor', 'rival-ready.com',
  'ready.csv', 'e1000000-0000-0000-0000-000000000002/ready.csv', 100,
  'ready', '{"url_index": 0}'::jsonb, 1, 1
);

select ok(
  'no_source' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002')),
  'an unconfirmed competitor CSV is not a source'
);
select ok(
  'unconfirmed_csv' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002')),
  'an unfinished upload is reported before start'
);
update public.jobs set budget_credits = 10
where id = 'e1000000-0000-0000-0000-000000000002';
select ok(
  'unconfirmed_csv' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002'))
  and not ('no_source' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002'))),
  'a search budget cannot hide an unfinished upload'
);
update public.jobs set budget_credits = 0
where id = 'e1000000-0000-0000-0000-000000000002';
update public.csv_uploads set status = 'discarded'
where id = 'e1000000-0000-0000-0000-000000000004';

insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, invalid_rows, confirmed_at
) values (
  'e1000000-0000-0000-0000-000000000005',
  'e1000000-0000-0000-0000-000000000002', 'competitor', 'rival-empty.com',
  'empty.csv', 'e1000000-0000-0000-0000-000000000002/empty.csv', 100,
  'confirmed', '{"url_index": 0}'::jsonb, 1, 0, 1, now()
);

select ok(
  'no_source' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002')),
  'a confirmed competitor CSV with no valid rows is not a source'
);

insert into public.csv_uploads (
  id, job_id, kind, competitor_label, filename, storage_path, size_bytes,
  status, mapping, total_rows, valid_rows, confirmed_at
) values (
  'e1000000-0000-0000-0000-000000000006',
  'e1000000-0000-0000-0000-000000000002', 'competitor', 'rival-good.com',
  'good.csv', 'e1000000-0000-0000-0000-000000000002/good.csv', 100,
  'confirmed', '{"url_index": 0}'::jsonb, 1, 1, now()
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select ok(
  not ('no_source' = any(public.job_start_problems('e1000000-0000-0000-0000-000000000002'))),
  'a confirmed competitor CSV with valid rows satisfies source readiness'
);
select lives_ok(
  $$select public.transition_job('e1000000-0000-0000-0000-000000000002', 'start')$$,
  'an Admin can start a CSV-only job'
);
select is(
  (select status::text from public.jobs where id = 'e1000000-0000-0000-0000-000000000002'),
  'queued', 'the CSV-only job becomes queued'
);

select * from finish();
rollback;
