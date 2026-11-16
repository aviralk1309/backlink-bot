begin;
select plan(5);

select has_table('public', 'job_storage_cleanup', 'durable cleanup queue exists');
select has_trigger('public', 'jobs', 'jobs_queue_storage_cleanup', 'job deletion queues cleanup');
select ok(not has_table_privilege('authenticated', 'public.job_storage_cleanup', 'SELECT'),
  'clients cannot inspect cleanup queue');
select ok(has_table_privilege('worker', 'public.job_storage_cleanup', 'DELETE'),
  'worker can acknowledge cleanup');

insert into public.jobs (id, name)
values ('e2000000-0000-0000-0000-000000000001', 'Cleanup test');
delete from public.jobs where id = 'e2000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.job_storage_cleanup
  where job_id = 'e2000000-0000-0000-0000-000000000001'), 1,
  'deleting a job persists its cleanup target');

select * from finish();
rollback;
