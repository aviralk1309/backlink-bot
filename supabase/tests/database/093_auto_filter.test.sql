begin;
select plan(14);
select is((select count(*)::integer from (values ('anon'),('authenticated'),('service_role')) r(name)
 where has_function_privilege(r.name,'public.worker_publish_check_filter(uuid,text,integer,integer,jsonb,text,text,text)','execute')),0,'API roles cannot publish filters');
select ok(has_function_privilege('worker','public.worker_publish_check_filter(uuid,text,integer,integer,jsonb,text,text,text)','execute'),'worker can publish');
insert into public.jobs(id,name,status,blocked_domains,skip_previously_spam_domains) values
 ('96000000-0000-0000-0000-000000000001','S6 keep spam','running',array['s6-jobblocked.example'],false),
 ('96000000-0000-0000-0000-000000000002','S6 skip spam','running','{}',true);
insert into public.blocklist(domain) values ('s6-blocked.example');
insert into public.domains(registered_domain,global_spam,global_spam_at)
 values ('s6-spam.example',true,now());
do $$ begin
 perform public.record_discovery('96000000-0000-0000-0000-000000000001','https://s6-blocked.example/a','https://s6-blocked.example/a','s6-blocked.example','s6-blocked.example','google','q1');
 perform public.record_discovery('96000000-0000-0000-0000-000000000001','https://s6-jobblocked.example/a','https://s6-jobblocked.example/a','s6-jobblocked.example','s6-jobblocked.example','google','q1');
 perform public.record_discovery('96000000-0000-0000-0000-000000000001','https://s6-spam.example/a','https://s6-spam.example/a','s6-spam.example','s6-spam.example','google','q1');
 perform public.record_discovery('96000000-0000-0000-0000-000000000002','https://s6-spam.example/a','https://s6-spam.example/a','s6-spam.example','s6-spam.example','google','q1');
end $$;
select is((select filter_detail from public.opportunities where domain='s6-blocked.example'), 'The domain is on the global blocklist.', 'global blocklist has readable reason');
select is((select filter_detail from public.opportunities where domain='s6-jobblocked.example'), 'The domain is excluded by this job.', 'job blocklist has readable reason');
select is((select filter_detail from public.opportunities where domain='s6-spam.example' and job_id='96000000-0000-0000-0000-000000000002'), 'Previously marked as spam; this job skips those domains.', 'skip-spam has readable reason');
select ok((select queue_group is null and filter_detail is null and flags->>'previously_spam'='true'
 from public.opportunities where domain='s6-spam.example' and job_id='96000000-0000-0000-0000-000000000001'), 'previous spam remains reviewable when skipping disabled');
select is((select count(*)::integer from public.opportunities where job_id in ('96000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000002')),4,'all discovery rows retained');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,first_source_type,config_version,check_status,locked_by,lease_expires_at,attempts)
 values ('96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000001','https://s6-check.example/a','https://s6-check.example/a','s6-check.example','s6-check.example','google',1,'running','s6',now()+interval '1 hour',1);
select throws_ok($$select public.worker_publish_check_filter('96000000-0000-0000-0000-000000000003','s6',1,1,
 '[{"check_key":"page_loads","status":"pass","reason_code":"page_loaded","detail":"","evidence":{}}]',
 'page_loads','page_gone','Page removed.')$$,'22023','filter_requires_failed_check','decision must reference failure in this publication');
select is((select count(*)::integer from public.opportunity_checks where opportunity_id='96000000-0000-0000-0000-000000000003'),0,'invalid decision rolls back raw checks too');
select is(public.worker_publish_check_filter('96000000-0000-0000-0000-000000000003','s6',1,1,
 '[{"check_key":"page_loads","status":"fail","reason_code":"page_gone","detail":"","evidence":{"http_status":410}}]',
 'page_loads','page_gone','Page has been removed (HTTP 410).'),true,'valid failure publishes');
select ok((select queue_group='auto_filtered' and filter_reason='page_gone' and filter_detail='Page has been removed (HTTP 410).' and check_status='done' and locked_by is null
 from public.opportunities where id='96000000-0000-0000-0000-000000000003'),'filtered row is retained and terminal with readable evidence');
set constraints all immediate;
select is((select unchecked_count from public.job_stats where job_id='96000000-0000-0000-0000-000000000001'),0,'filtered outcomes do not inflate unchecked counter');
select is((select count(*)::integer from public.opportunities where job_id='96000000-0000-0000-0000-000000000001'),4,'publication deletes nothing');
select throws_ok($$select public.worker_publish_check_filter('96000000-0000-0000-0000-000000000003','s6',1,1,'[]',null,'page_gone',null)$$,
 '22023','invalid_filter_decision','incomplete decision rejected');
select * from finish();
rollback;
