begin;
select plan(17);

insert into auth.users(id,email) values
  ('99200000-0000-0000-0000-000000000001','queries-admin@tests.local'),
  ('99200000-0000-0000-0000-000000000002','queries-viewer@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='99200000-0000-0000-0000-000000000001';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='99200000-0000-0000-0000-000000000002';
insert into public.jobs(id,name,status,status_reason,budget_credits) values
  ('99200000-0000-0000-0000-000000000011','Retry finished','failed','all_queries_failed',2),
  ('99200000-0000-0000-0000-000000000012','Spent','completed','budget_reached',1),
  ('99200000-0000-0000-0000-000000000013','Running','running',null,2),
  ('99200000-0000-0000-0000-000000000014','Running spent','running',null,1);
insert into public.job_queries(id,job_id,activity_key,template_id,template_version,
  query_text,status,attempts,error,completed_at) values
  ('99200000-0000-0000-0000-000000000021','99200000-0000-0000-0000-000000000011','guest_post','t1',1,'retry me','failed',3,'provider error',now()),
  ('99200000-0000-0000-0000-000000000022','99200000-0000-0000-0000-000000000012','guest_post','t1',1,'spent','failed',3,'provider error',now()),
  ('99200000-0000-0000-0000-000000000023','99200000-0000-0000-0000-000000000013','guest_post','t1',1,'done','done',1,null,now()),
  ('99200000-0000-0000-0000-000000000024','99200000-0000-0000-0000-000000000013','guest_post','t1',1,'failed','failed',3,'provider error',now()),
  ('99200000-0000-0000-0000-000000000025','99200000-0000-0000-0000-000000000014','guest_post','t1',1,'unaffordable','failed',3,'provider error',now());
update public.job_queries set credits_used=1,result_count=10,new_unique_domains=2
  where id='99200000-0000-0000-0000-000000000023';
update public.job_stats set credits_used=1,queries_total=2,queries_done=1
  where job_id='99200000-0000-0000-0000-000000000013';
update public.job_stats set credits_used=1
  where job_id in ('99200000-0000-0000-0000-000000000012',
    '99200000-0000-0000-0000-000000000014');

select ok(has_function_privilege('authenticated','public.retry_job_query(uuid,uuid)','execute'),
  'authenticated callers may request a retry');
select ok(not has_function_privilege('anon','public.retry_job_query(uuid,uuid)','execute'),
  'anon may not request a retry');
select ok(not has_table_privilege('authenticated','public.job_queries','update'),
  'browser users cannot bypass retry policy with table updates');

select set_config('request.jwt.claim.sub','99200000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.retry_job_query('99200000-0000-0000-0000-000000000011',
  '99200000-0000-0000-0000-000000000021')$$,
  '42501','permission_denied','viewer cannot retry a paid query');
select is((select count(*)::integer from public.job_query_yield(
  '99200000-0000-0000-0000-000000000013')),1,
  'viewer with jobs.view may read template yield');
reset role;

select set_config('request.jwt.claim.sub','99200000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.retry_job_query('99200000-0000-0000-0000-000000000012',
  '99200000-0000-0000-0000-000000000022')$$,
  '22023','job_not_retryable','budget-completed job stays closed');
select throws_ok($$select public.retry_job_query('99200000-0000-0000-0000-000000000013',
  '99200000-0000-0000-0000-000000000021')$$,
  '22023','query_not_failed','query cannot be retried from another job');
select throws_ok($$select public.retry_job_query('99200000-0000-0000-0000-000000000014',
  '99200000-0000-0000-0000-000000000025')$$,
  '22023','query_budget_reached','running job cannot retry beyond remaining credit');
select is(public.retry_job_query('99200000-0000-0000-0000-000000000011',
  '99200000-0000-0000-0000-000000000021'),'reopened',
  'all-query failure reopens when credit remains');
reset role;
select is((select status::text from public.jobs
  where id='99200000-0000-0000-0000-000000000011'),'running',
  'reopened job is running');
select ok((select status='pending' and attempts=0 and error is null and completed_at is null
  from public.job_queries where id='99200000-0000-0000-0000-000000000021'),
  'retry resets failure and attempts');
select is((select count(*)::integer from public.job_events
  where job_id='99200000-0000-0000-0000-000000000011' and type='query_retried'),1,
  'retry is audited');
select is((select credits_used::integer from public.job_stats
  where job_id='99200000-0000-0000-0000-000000000012'),1,
  'retry did not alter spent credit accounting');

select set_config('request.jwt.claim.sub','99200000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.retry_job_query('99200000-0000-0000-0000-000000000013',
  '99200000-0000-0000-0000-000000000024'),'queued',
  'running job queues only the failed row');
select throws_ok($$select public.retry_job_query('99200000-0000-0000-0000-000000000013',
  '99200000-0000-0000-0000-000000000024')$$,
  '22023','query_not_failed','double retry is rejected');
reset role;
select is((select new_unique_domains::integer from public.job_query_yield(
  '99200000-0000-0000-0000-000000000013')),2,
  'template yield sums new domains');
select is((select credits_used::integer from public.job_query_yield(
  '99200000-0000-0000-0000-000000000013')),1,
  'template yield sums credits');

select * from finish();
rollback;
