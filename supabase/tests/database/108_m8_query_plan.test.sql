begin;
select plan(10);

insert into public.jobs(id,name,status,budget_credits) values
  ('98000000-0000-0000-0000-000000000001','M8 running','running',2),
  ('98000000-0000-0000-0000-000000000002','M8 draft','draft',0);

select ok((select count(*)=2 from information_schema.columns
    where table_schema='public' and table_name='job_queries'
      and column_name in ('credits_used','lease_expires_at')),
  'M8 execution fields extend the report query identity');
select ok(has_table_privilege('worker','public.job_queries','insert')
  and not has_table_privilege('authenticated','public.job_queries','insert'),
  'only the worker can create query rows');

select lives_ok($$insert into public.job_queries
    (job_id,activity_key,template_id,template_version,query_text)
    values ('98000000-0000-0000-0000-000000000001','guest_post','t1',1,'write for us')$$,
  'a pending query can be stored for a running job');
select ok(exists (select 1 from pg_policies
    where schemaname='public' and tablename='job_queries'
      and policyname='job_queries_worker_insert' and cmd='INSERT'),
  'worker inserts are restricted by a dedicated RLS policy');

select throws_like($$insert into public.job_queries
    (job_id,activity_key,template_id,template_version,query_text)
    values ('98000000-0000-0000-0000-000000000001','guest_post','t2',1,'write for us')$$,
  '%job_queries_request_key%', 'null locale and location still deduplicate a request');
select lives_ok($$insert into public.job_queries
    (job_id,activity_key,template_id,template_version,query_text,num)
    values ('98000000-0000-0000-0000-000000000001','guest_post','t3',1,'write for us',20)$$,
  'a different result count is a distinct paid request');
select is((select status from public.job_queries
    where job_id='98000000-0000-0000-0000-000000000001' and num=10),
  'pending','new queries wait for a search executor');
select ok('queries_pending' = any(public.job_work_pending(
    '98000000-0000-0000-0000-000000000001')),
  'pending queries prevent premature completion');
select throws_like($$update public.job_queries set status='running'
    where job_id='98000000-0000-0000-0000-000000000001'$$,
  '%job_queries_running_has_lease%', 'a running query requires an owner and lease');
update public.job_queries set status='done', credits_used=1, result_count=0,
  new_unique_domains=0, completed_at=now()
  where job_id='98000000-0000-0000-0000-000000000001';
select is(cardinality(public.job_work_pending(
    '98000000-0000-0000-0000-000000000001')),0,
  'a finished query no longer blocks job completion');

select * from finish();
rollback;
