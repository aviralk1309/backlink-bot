begin;
select plan(13);

-- Fixtures: a2 manager (csv.upload), a3 viewer (jobs.view only).
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

insert into public.jobs (id, name, status) values
  ('80000000-0000-0000-0000-0000000000d1', 'M4 S5 draft', 'draft'),
  ('80000000-0000-0000-0000-0000000000f1', 'M4 S5 running', 'running')
on conflict (id) do update set status = excluded.status;

-- U1: mapped (draft job)
-- U2: ready (draft job)
-- U3: ready (running job)
-- U4: uploaded (draft job)
insert into public.csv_uploads
  (id, job_id, kind, competitor_label, filename, storage_path, size_bytes, status, mapping)
values
  ('83000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000d1',
   'competitor', 'rival.com', 'rival.csv', 'p/v1.csv', 1000, 'mapped', '{"url_index": 0}'::jsonb);

insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping,
   total_rows, valid_rows, invalid_rows, empty_rows)
values
  ('83000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c2.csv', 'p/v2.csv', 500, 'ready', '{"url_index": 0}'::jsonb, 10, 8, 1, 1);

insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping,
   total_rows, valid_rows, invalid_rows, empty_rows)
values
  ('83000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-0000000000f1',
   'client', 'c3.csv', 'p/v3.csv', 500, 'ready', '{"url_index": 0}'::jsonb, 10, 8, 1, 1);

insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status)
values
  ('83000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-0000000000d1',
   'client', 'c4.csv', 'p/v4.csv', 500, 'uploaded');

-- ---------------------------------------------------------------------
-- A. Privilege checks
-- ---------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'public.confirm_csv_upload(uuid)', 'execute'),
  'anon cannot run confirm_csv_upload'
);

select ok(
  not has_function_privilege('authenticated', 'public.worker_claim_csv_upload(text,integer,integer)', 'execute'),
  'authenticated cannot run worker_claim_next_csv_upload'
);

select ok(
  has_function_privilege('worker', 'public.worker_claim_csv_upload(text,integer,integer)', 'execute'),
  'worker can run worker_claim_next_csv_upload'
);

-- ---------------------------------------------------------------------
-- B. confirm_csv_upload checks
-- ---------------------------------------------------------------------
set local role authenticated;

-- viewer cannot confirm
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.confirm_csv_upload('83000000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'viewer cannot confirm an upload'
);

-- manager can confirm
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);

-- ready on running job fails
select throws_ok(
  $$select public.confirm_csv_upload('83000000-0000-0000-0000-000000000003')$$,
  '55000', null,
  'cannot confirm an upload on a non-draft job'
);

-- uploaded (not ready) fails
select throws_ok(
  $$select public.confirm_csv_upload('83000000-0000-0000-0000-000000000004')$$,
  '55000', null,
  'cannot confirm an upload that is not ready'
);

-- ready on draft job succeeds
select lives_ok(
  $$select public.confirm_csv_upload('83000000-0000-0000-0000-000000000002')$$,
  'manager can confirm a ready upload'
);

select is(
  (select status::text from public.csv_uploads where id = '83000000-0000-0000-0000-000000000002'),
  'confirmed'::text,
  'upload status moved to confirmed'
);

select ok(
  (select confirmed_at is not null from public.csv_uploads where id = '83000000-0000-0000-0000-000000000002'),
  'confirmed_at was populated'
);

-- idempotent on already confirmed
select lives_ok(
  $$select public.confirm_csv_upload('83000000-0000-0000-0000-000000000002')$$,
  'confirming an already-confirmed upload is a safe no-op'
);

-- ---------------------------------------------------------------------
-- C. worker_claim_next_csv_upload checks
-- ---------------------------------------------------------------------
create or replace function pg_temp.claim_as_worker() returns text
language plpgsql
as $$
declare
  r text;
begin
  set local role worker;
  select id::text into r from public.worker_claim_csv_upload('sql-test', 120, 3);
  reset role;
  return r;
end;
$$;

create or replace function pg_temp.count_claims_as_worker() returns int
language plpgsql
as $$
declare
  r int;
begin
  set local role worker;
  select count(*)::int into r from public.worker_claim_csv_upload('sql-test', 120, 3);
  reset role;
  return r;
end;
$$;

select is(
  pg_temp.claim_as_worker(),
  '83000000-0000-0000-0000-000000000001'::text,
  'worker claims the mapped upload'
);

select is(
  (select status::text from public.csv_uploads where id = '83000000-0000-0000-0000-000000000001'),
  'processing'::text,
  'claimed upload status moved to processing'
);

-- queue now empty for next claim
select is(
  pg_temp.count_claims_as_worker(),
  0,
  'subsequent claim returns empty when no mapped uploads remain'
);

rollback;
