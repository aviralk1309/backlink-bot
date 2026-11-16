begin;
select plan(8);
select ok((select relrowsecurity from pg_class where oid='public.opportunity_checks'::regclass), 'RLS enabled');
select ok(has_table_privilege('worker','public.opportunity_checks','SELECT'), 'worker reads checks');
select ok(not has_table_privilege('worker','public.opportunity_checks','INSERT'), 'worker writes through RPC only');
select ok(not has_table_privilege('authenticated','public.opportunity_checks','UPDATE'), 'clients cannot change evidence');
select is((select count(*)::integer from (values ('anon'),('authenticated'),('service_role')) r(name)
 where has_function_privilege(r.name,'public.worker_save_opportunity_checks(uuid,text,integer,integer,jsonb)','execute')),0,'API roles cannot publish checks');
select ok(has_function_privilege('worker','public.worker_save_opportunity_checks(uuid,text,integer,integer,jsonb)','execute'), 'worker can publish');
select throws_ok($$select public.worker_save_opportunity_checks(gen_random_uuid(),'worker',1,1,'[]')$$,
 '22023','invalid_check_results','empty run rejected');
select throws_ok($$select public.worker_save_opportunity_checks(gen_random_uuid(),'worker',1,1,'{}')$$,
 '22023','invalid_check_results','non-array rejected');
select * from finish();
rollback;
