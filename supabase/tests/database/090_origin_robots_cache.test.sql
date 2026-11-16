begin;
select plan(12);
select ok((select relrowsecurity from pg_class where oid = 'public.origin_robots_cache'::regclass), 'RLS enabled');
select ok(not has_table_privilege('worker', 'public.origin_robots_cache', 'UPDATE'), 'worker cannot bypass leases');
select is((select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r(name)
 where has_function_privilege(r.name, 'public.worker_claim_robots(text,text,uuid)', 'execute')), 0, 'API roles cannot claim');
select is((select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r(name)
 where has_function_privilege(r.name, 'public.worker_complete_robots(text,uuid,text,text,integer)', 'execute')), 0, 'API roles cannot complete');
select is((select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r(name)
 where has_function_privilege(r.name, 'public.worker_block_origin(text,integer)', 'execute')), 0, 'API roles cannot block');
grant usage on schema extensions to worker;
set local search_path = public, extensions;
set local role worker;
select is(public.worker_claim_robots('https://robots-test.com:443', 'robots-test.com', '10000000-0000-0000-0000-000000000001')->>'action', 'refresh', 'worker can claim');
select is(public.worker_claim_robots('https://robots-test.com:443', 'robots-test.com', '10000000-0000-0000-0000-000000000002')->>'action', 'wait', 'second worker waits');
select is(public.worker_complete_robots('https://robots-test.com:443', '10000000-0000-0000-0000-000000000002', 'absent', '', 86400), false, 'wrong owner fenced');
select throws_ok($$select public.worker_complete_robots('https://robots-test.com:443', '10000000-0000-0000-0000-000000000001', 'absent', '', 86401)$$, '22023', 'invalid_robots_ttl', 'TTL capped at 24h');
select is(public.worker_complete_robots('https://robots-test.com:443', '10000000-0000-0000-0000-000000000001', 'absent', '', 86400), true, 'owner completes');
select is(public.worker_claim_robots('https://robots-test.com:443', 'robots-test.com', '10000000-0000-0000-0000-000000000002')->>'action', 'cached', 'cache reused');
select throws_ok($$select public.worker_block_origin('https://robots-test.com:443', -1)$$, '22023', 'invalid_origin_cooldown', 'invalid cooldown rejected');
reset role;
select * from finish();
rollback;
