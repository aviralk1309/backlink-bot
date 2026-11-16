begin;
select plan(10);
select ok((select relrowsecurity from pg_class where oid = 'public.fetch_domain_limits'::regclass), 'RLS enabled');
select is((select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r(name)
 where has_function_privilege(r.name, 'public.worker_acquire_fetch_slot(text,double precision)', 'execute')),
 0, 'API roles cannot acquire slots');
select ok(has_function_privilege('worker', 'public.worker_acquire_fetch_slot(text,double precision)', 'execute'), 'worker RPC allowed');
select ok(not has_table_privilege('worker', 'public.fetch_domain_limits', 'UPDATE'), 'worker cannot bypass RPC');
select is(public.worker_acquire_fetch_slot('sql-rate-test.example', 10), 0::double precision, 'first granted');
select ok(public.worker_acquire_fetch_slot('sql-rate-test.example', 10) > 9, 'second must wait');
select is(public.worker_acquire_fetch_slot('different-rate-test.example', 10), 0::double precision, 'other domain independent');
select throws_ok($$select public.worker_acquire_fetch_slot('', 2)$$, '22023', 'invalid_fetch_domain', 'invalid key rejected');
select throws_ok($$select public.worker_acquire_fetch_slot('example.com', -1)$$, '22023', 'invalid_fetch_delay', 'negative rejected');
select throws_ok($$select public.worker_acquire_fetch_slot('example.com', 'NaN')$$, '22023', 'invalid_fetch_delay', 'NaN rejected');
select * from finish();
rollback;
