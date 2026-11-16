begin;
select plan(11);

insert into public.jobs(id,name,status,budget_credits) values
  ('99000000-0000-0000-0000-000000000001','Budget job','running',2),
  ('99000000-0000-0000-0000-000000000002','Failed search job','running',2);
insert into public.job_queries(job_id,activity_key,template_id,template_version,query_text,priority)
values
  ('99000000-0000-0000-0000-000000000001','guest_post','t1',1,'query one',1),
  ('99000000-0000-0000-0000-000000000001','guest_post','t1',1,'query two',2),
  ('99000000-0000-0000-0000-000000000001','guest_post','t1',1,'query three',3),
  ('99000000-0000-0000-0000-000000000002','guest_post','t1',1,'all failed',1);
update public.job_queries set status='failed' where job_id='99000000-0000-0000-0000-000000000002';

select ok(has_function_privilege('worker','public.claim_budgeted_query(text,integer,integer)','execute'),
  'worker can claim budgeted queries');
select ok(not has_function_privilege('authenticated',
  'public.claim_budgeted_query(text,integer,integer)','execute'),
  'browser users cannot claim paid queries');
select ok(has_function_privilege('worker','public.worker_lock_search_job(uuid)','execute'),
  'worker can serialize search publication with paid claims');
select ok(not has_function_privilege('authenticated','public.worker_lock_search_job(uuid)','execute'),
  'browser users cannot take the search publication lock');

set local role worker;
select count(*) from public.claim_budgeted_query('s5-a',120,3);
select count(*) from public.claim_budgeted_query('s5-b',120,3);
select count(*) from public.claim_budgeted_query('s5-c',120,3);
reset role;
select is((select count(*) from public.job_queries
  where job_id='99000000-0000-0000-0000-000000000001' and status='running'),2::bigint,
  'only two paid claims fit the shared reservation');

select ok('queries_pending'=any(public.job_work_pending(
  '99000000-0000-0000-0000-000000000001')),
  'running queries keep the job open');
update public.job_stats set credits_used=2
  where job_id='99000000-0000-0000-0000-000000000001';
select ok('queries_pending'=any(public.job_work_pending(
  '99000000-0000-0000-0000-000000000001')),
  'reported budget exhaustion still waits for in-flight queries');
update public.job_queries set status='done',locked_by=null,lease_expires_at=null
  where job_id='99000000-0000-0000-0000-000000000001' and status='running';
select is(cardinality(public.job_work_pending(
  '99000000-0000-0000-0000-000000000001')),0,
  'unstarted queries stop blocking once the budget is spent');

select is((select count(*) from public.worker_complete_drained_jobs()),1::bigint,
  'completion sweep returns only completed jobs, not all-query failures');
select is((select status::text || '/' || status_reason from public.jobs
  where id='99000000-0000-0000-0000-000000000001'),
  'completed/budget_reached','spent job completes with the budget reason');
select is((select status::text || '/' || status_reason from public.jobs
  where id='99000000-0000-0000-0000-000000000002'),
  'failed/all_queries_failed','a job whose every query failed is not marked complete');

select * from finish();
rollback;
