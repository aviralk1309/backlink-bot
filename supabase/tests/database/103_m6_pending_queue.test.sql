begin;
select plan(16);

insert into auth.users(id,email) values
  ('96000000-0000-0000-0000-000000000101','queue-admin@tests.local'),
  ('96000000-0000-0000-0000-000000000102','queue-viewer@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='96000000-0000-0000-0000-000000000101';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='96000000-0000-0000-0000-000000000102';
insert into public.jobs(id,name,review_queue_size) values
  ('96000000-0000-0000-0000-000000000110','Pending queue test',2),
  ('96000000-0000-0000-0000-000000000120','Worker refill test',1);
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,check_status,score,tier) values
  ('96000000-0000-0000-0000-000000000111','96000000-0000-0000-0000-000000000110','https://queue.example/1','https://queue.example/1','queue.example','queue.example','seed_list',1,'ready','done',80,'high'),
  ('96000000-0000-0000-0000-000000000112','96000000-0000-0000-0000-000000000110','https://queue.example/2','https://queue.example/2','queue.example','queue.example','seed_list',1,'ready','done',70,'high'),
  ('96000000-0000-0000-0000-000000000113','96000000-0000-0000-0000-000000000110','https://queue.example/3','https://queue.example/3','queue.example','queue.example','seed_list',1,'backlog','done',60,'medium'),
  ('96000000-0000-0000-0000-000000000114','96000000-0000-0000-0000-000000000110','https://queue.example/4','https://queue.example/4','queue.example','queue.example','seed_list',1,'backlog','done',50,'low'),
  ('96000000-0000-0000-0000-000000000115','96000000-0000-0000-0000-000000000110','https://queue.example/5','https://queue.example/5','queue.example','queue.example','seed_list',1,'backlog','done',95,'high'),
  ('96000000-0000-0000-0000-000000000121','96000000-0000-0000-0000-000000000120','https://queue.example/6','https://queue.example/6','queue.example','queue.example','seed_list',1,'ready','done',80,'high');
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where score is not null and job_id in ('96000000-0000-0000-0000-000000000110',
    '96000000-0000-0000-0000-000000000120');

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000102',true);
set local role authenticated;
select throws_ok($$select public.release_backlog('96000000-0000-0000-0000-000000000110')$$,
  '42501','permission_denied','Viewer cannot release a batch');
reset role;

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000101',true);
set local role authenticated;
select is(public.release_backlog('96000000-0000-0000-0000-000000000110'),0,
  'full pending window blocks release');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000110',
  '[{"id":"96000000-0000-0000-0000-000000000111","version":0}]','claim'),
  'saved','claim still occupies a pending slot');
select is(public.release_backlog('96000000-0000-0000-0000-000000000110'),0,
  'claimed row does not free capacity');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000110',
  '[{"id":"96000000-0000-0000-0000-000000000111","version":1}]','approve'),
  'saved','decision frees a pending slot');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000110',
  '[{"id":"96000000-0000-0000-0000-000000000115","version":0}]','claim'),
  'saved','Backlog row can be reviewed');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000110',
  '[{"id":"96000000-0000-0000-0000-000000000115","version":1}]','approve'),
  'saved','decided Backlog row is excluded from release');
select is(public.release_backlog('96000000-0000-0000-0000-000000000110'),1,
  'release fills only the free pending slot');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000110',
  '[{"id":"96000000-0000-0000-0000-000000000111","version":2}]','reopen'),
  'queue_full','reopen cannot exceed the pending window');
select is(public.release_backlog('96000000-0000-0000-0000-000000000110'),0,
  'full pending window remains bounded');
reset role;
select ok((select queue_group='ready' from public.opportunities where id='96000000-0000-0000-0000-000000000113')
  and (select queue_group='backlog' from public.opportunities where id='96000000-0000-0000-0000-000000000115'),
  'best undecided Backlog row moves; decided row retains history');
select is((select count(*)::integer from public.opportunities where job_id='96000000-0000-0000-0000-000000000110'
  and queue_group='ready' and review_status in ('new','in_review')),2,
  'Ready has exactly two pending rows');
select is((select count(*)::integer from public.job_events where job_id='96000000-0000-0000-0000-000000000110'
  and type='backlog_released'),1,'successful release writes one event');

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000101',true);
set local role authenticated;
select is(public.review_opportunities('96000000-0000-0000-0000-000000000120',
  '[{"id":"96000000-0000-0000-0000-000000000121","version":0}]','claim'),
  'saved','worker fixture row claimed');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000120',
  '[{"id":"96000000-0000-0000-0000-000000000121","version":1}]','approve'),
  'saved','worker fixture row decided');
reset role;
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,check_status,locked_by,lease_expires_at,attempts,score,tier) values
  ('96000000-0000-0000-0000-000000000122','96000000-0000-0000-0000-000000000120','https://queue.example/7','https://queue.example/7','queue.example','queue.example','seed_list',1,'running','s6-worker',now()+interval '1 hour',1,55,'medium');
insert into public.opportunity_checks(opportunity_id,check_key,status,reason_code,config_version) values
  ('96000000-0000-0000-0000-000000000122','page','pass','ok',1);
grant usage on schema extensions to worker;
set local search_path = public, extensions;
set local role worker;
select is(public.worker_assign_opportunity_queue('96000000-0000-0000-0000-000000000122','s6-worker',1,1)::text,
  'ready','worker fills the slot freed by a decision');
reset role;

select * from finish();
rollback;
