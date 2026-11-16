begin;
select plan(11);

insert into public.jobs(id,name,review_queue_size) values
  ('e1140000-0000-0000-0000-000000000001','Quality Ready queue',2);
insert into auth.users(id,email) values
  ('e1140000-0000-0000-0000-000000000099','quality-reviewer@tests.local');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,check_status,locked_by,lease_expires_at,attempts,score,tier)
select ('e1140000-0000-0000-0000-0000000000' || n::text)::uuid,
  'e1140000-0000-0000-0000-000000000001',
  'https://queue.example/' || n,'https://queue.example/' || n,
  'queue.example','queue.example','seed_list',1,'running','quality-worker',
  now()+interval '1 hour',1,
  case n when 11 then 10 when 12 then 0 when 13 then 60
    when 14 then 80 when 15 then 5 else 90 end,
  case n when 12 then 'unchecked' when 13 then 'medium'
    when 14 then 'high' when 16 then 'high' else 'low' end::public.opportunity_tier
from generate_series(11,16) n;
insert into public.opportunity_checks(opportunity_id,check_key,status,reason_code,config_version)
select id,'page','pass','ok',1 from public.opportunities
where job_id='e1140000-0000-0000-0000-000000000001';

select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000011',
  'quality-worker',1,1)::text,'ready','first result fills Ready');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000012',
  'quality-worker',1,1)::text,'ready','second result fills Ready');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000013',
  'quality-worker',1,1)::text,'ready','checked medium result displaces unchecked result');
select is((select queue_group::text from public.opportunities
  where id='e1140000-0000-0000-0000-000000000012'),
  'backlog','displaced unchecked result remains available in Backlog');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000014',
  'quality-worker',1,1)::text,'ready','higher score displaces lower Ready score');
select is((select array_agg(score order by score) from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001' and queue_group='ready'),
  array[60::numeric,80::numeric],'Ready contains the two strongest pending results');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000015',
  'quality-worker',1,1)::text,'backlog','weaker result stays in Backlog');
select is((select array_agg(first_ready_rank order by first_ready_rank) from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001' and first_ready),
  array[1,2],'initial exposure history is unchanged by ranking');

update public.opportunities set review_status='in_review',
  reviewer_id='e1140000-0000-0000-0000-000000000099'
where id='e1140000-0000-0000-0000-000000000013';
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000016',
  'quality-worker',1,1)::text,'ready','new best result can replace an unclaimed row');
select is((select queue_group::text from public.opportunities
  where id='e1140000-0000-0000-0000-000000000013'),
  'ready','claimed result remains in Ready');
select is((select count(*)::integer from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001'
    and queue_group='ready' and review_status in ('new','in_review')),
  2,'pending Ready capacity remains bounded');

select * from finish();
rollback;
