begin;
select plan(15);
select ok((select relrowsecurity from pg_class where oid='public.domain_check_budgets'::regclass), 'budget RLS');
select ok((select relrowsecurity from pg_class where oid='public.opportunity_check_admissions'::regclass), 'admission RLS');
select ok(not has_table_privilege('worker','public.domain_check_budgets','UPDATE'), 'worker cannot refill budget');
select ok(not has_table_privilege('worker','public.opportunity_check_admissions','INSERT'), 'worker cannot self-admit');
select is((select count(*)::integer from (values ('anon'),('authenticated'),('service_role')) r(name)
 where has_function_privilege(r.name,'public.claim_opportunity_checks(text,integer,integer)','execute')),0,'API roles cannot claim');

insert into public.jobs(id,name,status,per_domain_cap) values ('95000000-0000-0000-0000-000000000001','S5 quota','running',2);
insert into public.opportunities(job_id,original_url,normalized_url,host,domain,first_source_type,config_version)
select '95000000-0000-0000-0000-000000000001','https://s5.example/'||g,'https://s5.example/'||g,
 's5.example','s5.example','google',1 from generate_series(1,5) g;
select is((select count(*)::integer from public.claim_opportunity_checks('s5-sql',10,30)),2,'only two admitted');
select is((select count(*)::integer from public.opportunities where job_id='95000000-0000-0000-0000-000000000001'
 and check_reason='domain_cap' and check_status='skipped' and tier='unchecked' and queue_group='backlog' and attempts=0),3,'excess URLs untouched by handler');
set constraints all immediate;
select is((select unchecked_count from public.job_stats where job_id='95000000-0000-0000-0000-000000000001'),3,'existing stats trigger counts skipped rows');
select is(public.release_opportunity_claims('s5-sql'),2,'release admitted claims');
select is((select count(*)::integer from public.claim_opportunity_checks('s5-sql-again',10,30)),2,'retries keep slots');
select is((select admitted_count from public.domain_check_budgets where job_id='95000000-0000-0000-0000-000000000001'),2,'retry does not increment count');

insert into public.activity_profiles(key,name,per_domain_cap) values ('s5_test_profile','S5 profile',3);
insert into public.jobs(id,name,status,per_domain_cap,activity_keys) values
 ('95000000-0000-0000-0000-000000000002','S5 override','running',1,array['s5_test_profile']);
insert into public.job_config_history(job_id,version,snapshot)
select id,config_version,public.job_config_snapshot(j) from public.jobs j where id='95000000-0000-0000-0000-000000000002';
update public.activity_profiles set per_domain_cap=8 where key='s5_test_profile';
select is((select snapshot->'activity_check_caps'->>'s5_test_profile' from public.job_config_history
 where job_id='95000000-0000-0000-0000-000000000002'),'3','profile override remains frozen');
insert into public.opportunities(job_id,original_url,normalized_url,host,domain,first_source_type,config_version)
select '95000000-0000-0000-0000-000000000002','https://s5.example/'||g,'https://s5.example/'||g,
 's5.example','s5.example','google',1 from generate_series(1,5) g;
select is((select count(*)::integer from public.claim_opportunity_checks('s5-profile',10,30)),3,'frozen override applies, not live edited value');
select throws_like($$select * from public.claim_opportunity_checks('x',null,30)$$,'invalid_batch%','null batch rejected');
select throws_like($$select * from public.claim_opportunity_checks('x',1,null)$$,'invalid_lease_seconds%','null lease rejected');
select * from finish();
rollback;
