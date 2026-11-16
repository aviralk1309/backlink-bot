begin;
select plan(3);

select ok(has_column_privilege('worker','public.job_queries','status','update')
  and has_column_privilege('worker','public.job_queries','credits_used','update'),
  'worker can publish query lifecycle and reported credits');
select ok(not has_table_privilege('authenticated','public.job_queries','update'),
  'browser users cannot change query execution state');
select ok(exists (select 1 from pg_policies where schemaname='public'
  and tablename='job_queries' and policyname='job_queries_worker_update'
  and cmd='UPDATE' and roles='{worker}'),
  'query updates are scoped to the worker role');

select * from finish();
rollback;
