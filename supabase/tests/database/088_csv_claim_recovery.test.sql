begin;
select plan(25);

select has_column('public', 'csv_uploads', 'locked_by', 'CSV claim owner');
select has_column('public', 'csv_uploads', 'claim_token', 'CSV claim fencing token');
select has_column('public', 'csv_uploads', 'lease_expires_at', 'CSV lease expiry');
select has_column('public', 'csv_uploads', 'processing_attempts', 'durable attempt counter');
select col_not_null('public', 'csv_uploads', 'processing_attempts', 'attempts always recorded');

select is((select count(*)::integer
  from (values ('anon'), ('authenticated'), ('service_role')) r(name)
  cross join (values
    ('public.worker_claim_csv_upload(text,integer,integer)'),
    ('public.worker_reap_csv_uploads(integer,integer)'),
    ('public.worker_renew_csv_claim(uuid,uuid,integer)')
  ) f(sig) where has_function_privilege(r.name, f.sig, 'execute')),
  0, 'browser and service roles cannot manage CSV claims');
select ok(
  has_function_privilege('worker', 'public.worker_claim_csv_upload(text,integer,integer)', 'execute')
  and has_function_privilege('worker', 'public.worker_reap_csv_uploads(integer,integer)', 'execute')
  and has_function_privilege('worker', 'public.worker_renew_csv_claim(uuid,uuid,integer)', 'execute'),
  'worker can claim, reap and renew');
select is((select count(*)::integer
  from (values ('locked_by'), ('claim_token'), ('lease_expires_at'), ('processing_attempts')) c(name)
  where has_column_privilege('authenticated', 'public.csv_uploads', c.name, 'UPDATE')
     or has_column_privilege('authenticated', 'public.csv_uploads', c.name, 'INSERT')),
  0, 'clients cannot forge claim fields');

select throws_ok($$select * from public.worker_claim_next_csv_upload()$$,
  '55000', 'csv_worker_upgrade_required', 'old workers fail closed');
select throws_ok($$select * from public.worker_claim_csv_upload('worker', 0, 3)$$,
  '22023', 'invalid_csv_claim_parameters', 'lease bounds enforced');
select throws_ok($$select * from public.worker_claim_csv_upload(' ', 120, 3)$$,
  '22023', 'invalid_csv_claim_parameters', 'worker identity required');
select throws_ok($$select * from public.worker_claim_csv_upload('worker', 120, 0)$$,
  '22023', 'invalid_csv_claim_parameters', 'attempt limit enforced');
select throws_ok($$select public.worker_reap_csv_uploads(3, null)$$,
  '22023', 'invalid_csv_reap_limits', 'null reaper limit refused');
select throws_ok($$select public.worker_renew_csv_claim(null, null, 0)$$,
  '22023', 'invalid_csv_lease_seconds', 'renewal lease bounds enforced');

-- Park unrelated test/dev work inside this rolled-back transaction.
update public.csv_uploads set status = 'discarded', locked_by = null,
  claim_token = null, lease_expires_at = null where status in ('mapped', 'processing');
insert into public.jobs (id, name) values
  ('88000000-0000-0000-0000-000000000001', 'lease SQL test');
insert into public.csv_uploads
  (id, job_id, kind, filename, storage_path, size_bytes, status, mapping)
values ('88000000-0000-0000-0000-000000000002',
        '88000000-0000-0000-0000-000000000001', 'client', 'test.csv', 'lease/test.csv',
        100, 'mapped', '{"url_index":0}');
create temp table attempts as select * from public.worker_claim_csv_upload('sql-worker', 120, 2);
select is((select count(*)::integer from attempts), 1, 'one mapped upload is claimed');
select ok((select status = 'processing' and locked_by = 'sql-worker'
  and claim_token is not null and lease_expires_at > clock_timestamp()
  and processing_attempts = 1 from attempts), 'claim creates durable ownership');
select is(public.worker_renew_csv_claim(
  '88000000-0000-0000-0000-000000000002', gen_random_uuid(), 120), false,
  'wrong token cannot renew');
select is(public.worker_renew_csv_claim(
  '88000000-0000-0000-0000-000000000002', (select claim_token from attempts), 120), true,
  'current token renews');
select is(public.worker_reap_csv_uploads(2), 0, 'live leases are not reaped');
update public.csv_uploads set lease_expires_at = clock_timestamp() - interval '1 second'
 where id = '88000000-0000-0000-0000-000000000002';
select is(public.worker_renew_csv_claim(
  '88000000-0000-0000-0000-000000000002', (select claim_token from attempts), 120), false,
  'expired lease cannot be resurrected');
select is(public.worker_reap_csv_uploads(2), 1, 'expired claim is requeued');
select ok((select claim_token <> (select claim_token from attempts) and processing_attempts = 2
  from public.worker_claim_csv_upload('replacement-worker', 120, 2)),
  'retry has a new token and durable attempt number');
update public.csv_uploads set lease_expires_at = clock_timestamp() - interval '1 second'
 where id = '88000000-0000-0000-0000-000000000002';
do $$begin perform public.worker_reap_csv_uploads(2); end$$;
select is((select status::text || ':' || status_reason from public.csv_uploads
  where id = '88000000-0000-0000-0000-000000000002'),
  'failed:csv_attempts_exhausted', 'exhaustion is a visible failure');
select is((select count(*)::integer from public.worker_claim_csv_upload('worker', 120, 2)),
  0, 'exhausted uploads are not claimed again');
update public.csv_uploads set status = 'processing', processing_attempts = 0
 where id = '88000000-0000-0000-0000-000000000002';
do $$begin perform public.worker_reap_csv_uploads(3); end$$;
select is((select status::text || ':' || processing_attempts::text from public.csv_uploads
  where id = '88000000-0000-0000-0000-000000000002'),
  'mapped:1', 'legacy processing row recovered without deleting upload data');

select * from finish();
rollback;
