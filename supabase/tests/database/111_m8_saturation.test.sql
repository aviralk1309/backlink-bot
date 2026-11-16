begin;
select plan(11);

insert into public.jobs(id,name,status,budget_credits,saturation_n,saturation_x) values
  ('99100000-0000-0000-0000-000000000001','Sliding window','running',10,3,2),
  ('99100000-0000-0000-0000-000000000002','Disabled rule','running',10,1,0),
  ('99100000-0000-0000-0000-000000000003','CSV only','running',0,1,1);
insert into public.job_queries(job_id,activity_key,template_id,template_version,
  query_text,priority,status,credits_used,new_unique_domains,completed_at) values
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'one',1,'done',1,1,now()-interval '3 minutes'),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'two',2,'done',1,1,now()-interval '2 minutes'),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'three',3,'pending',null,null,null),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'failed',4,'failed',null,100,now()-interval '1 minute'),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'four',5,'pending',null,null,null),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'five',6,'pending',null,null,null),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'six',7,'pending',null,null,null),
  ('99100000-0000-0000-0000-000000000001','guest_post','t1',1,'seven',8,'pending',null,null,null),
  ('99100000-0000-0000-0000-000000000002','guest_post','t1',1,'disabled done',1,'done',1,0,now()),
  ('99100000-0000-0000-0000-000000000002','guest_post','t1',1,'disabled pending',2,'pending',null,null,null);
update public.job_stats set queries_done=2,credits_used=2
  where job_id='99100000-0000-0000-0000-000000000001';
update public.job_stats set queries_done=1,credits_used=1
  where job_id='99100000-0000-0000-0000-000000000002';

select ok(not public.evaluate_job_saturation('99100000-0000-0000-0000-000000000001'),
  'fewer than N completed queries never saturate');
select is((select status::text from public.jobs
  where id='99100000-0000-0000-0000-000000000001'),'running',
  'the under-sample job keeps running');
update public.job_queries set status='done',credits_used=1,new_unique_domains=0,
  completed_at=now()-interval '1 minute'
  where job_id='99100000-0000-0000-0000-000000000001' and query_text='three';
update public.job_stats set queries_done=3,credits_used=3
  where job_id='99100000-0000-0000-0000-000000000001';
select ok(not public.evaluate_job_saturation('99100000-0000-0000-0000-000000000001'),
  'sum equal to X does not saturate');
update public.job_queries set new_unique_domains=0
  where job_id='99100000-0000-0000-0000-000000000001' and query_text='one';
select ok(public.evaluate_job_saturation('99100000-0000-0000-0000-000000000001'),
  'sum below X saturates and ignores a failed query with high yield');
select is((select status::text from public.jobs
  where id='99100000-0000-0000-0000-000000000001'),'saturated',
  'low-yield job auto-pauses');

select public.job_apply_transition('99100000-0000-0000-0000-000000000001','resume',null,null);
select is((select saturation_recheck_after from public.job_stats
  where job_id='99100000-0000-0000-0000-000000000001'),6,
  'Resume requires N more completed queries');
update public.job_queries set status='done',credits_used=1,new_unique_domains=0,
  completed_at=now()+interval '1 minute'
  where job_id='99100000-0000-0000-0000-000000000001' and query_text='four';
update public.job_stats set queries_done=4,credits_used=4
  where job_id='99100000-0000-0000-0000-000000000001';
select ok(not public.evaluate_job_saturation('99100000-0000-0000-0000-000000000001'),
  'one new completed query is below the resume window');
update public.job_queries set status='done',credits_used=1,new_unique_domains=0,
  completed_at=now()+interval '2 minutes'
  where job_id='99100000-0000-0000-0000-000000000001' and query_text='five';
update public.job_stats set queries_done=5,credits_used=5
  where job_id='99100000-0000-0000-0000-000000000001';
select ok(not public.evaluate_job_saturation('99100000-0000-0000-0000-000000000001'),
  'two new completed queries still wait');
update public.job_queries set status='done',credits_used=1,new_unique_domains=0,
  completed_at=now()+interval '3 minutes'
  where job_id='99100000-0000-0000-0000-000000000001' and query_text='six';
update public.job_stats set queries_done=6,credits_used=6
  where job_id='99100000-0000-0000-0000-000000000001';
select ok(public.evaluate_job_saturation('99100000-0000-0000-0000-000000000001'),
  'the third new low-yield query saturates again');
select ok(not public.evaluate_job_saturation('99100000-0000-0000-0000-000000000002'),
  'X=0 disables saturation');

select opp_id from public.record_discovery('99100000-0000-0000-0000-000000000003',
  'https://csv.example.com/x','https://csv.example.com/x',
  'csv.example.com','example.com','competitor_csv','rival');
select ok(not public.evaluate_job_saturation('99100000-0000-0000-0000-000000000003'),
  'CSV-only discoveries do not enter the query saturation window');

select * from finish();
rollback;
