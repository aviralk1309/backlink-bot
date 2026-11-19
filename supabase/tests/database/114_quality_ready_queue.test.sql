begin;
select plan(16);

insert into public.jobs(id,name,review_queue_size) values
  ('e1140000-0000-0000-0000-000000000001','Quality Ready queue',2);
insert into auth.users(id,email) values
  ('e1140000-0000-0000-0000-000000000099','quality-reviewer@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='e1140000-0000-0000-0000-000000000099';
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
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where job_id='e1140000-0000-0000-0000-000000000001';
insert into public.opportunity_checks(opportunity_id,check_key,status,reason_code,config_version)
select id,'page','pass','ok',1 from public.opportunities
where job_id='e1140000-0000-0000-0000-000000000001';

select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000011',
  'quality-worker',1,1)::text,'ready','first result fills Ready');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000012',
  'quality-worker',1,1)::text,'ready','second result fills Ready');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000013',
  'quality-worker',1,1)::text,'backlog','later checked result waits while Ready is full');
select is((select queue_group::text from public.opportunities
  where id='e1140000-0000-0000-0000-000000000012'),
  'ready','unclaimed unchecked Ready result is not displaced');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000014',
  'quality-worker',1,1)::text,'backlog','higher-scored later result does not displace Ready');
select is((select array_agg(score order by score) from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001' and queue_group='ready'),
  array[0::numeric,10::numeric],'Ready keeps the first two exposed results');
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000015',
  'quality-worker',1,1)::text,'backlog','weaker result stays in Backlog');
select is((select array_agg(first_ready_rank order by first_ready_rank) from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001' and first_ready),
  array[1,2],'initial exposure rank remains stable');

update public.opportunities set review_status='in_review',
  reviewer_id='e1140000-0000-0000-0000-000000000099'
where id='e1140000-0000-0000-0000-000000000011';
select is(public.worker_assign_opportunity_queue('e1140000-0000-0000-0000-000000000016',
  'quality-worker',1,1)::text,'backlog','claimed Ready result also holds its slot');
select is((select queue_group::text from public.opportunities
  where id='e1140000-0000-0000-0000-000000000011'),
  'ready','claimed result remains in Ready');
select is((select count(*)::integer from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001'
    and queue_group='ready' and review_status in ('new','in_review')),
  2,'pending Ready capacity remains bounded');

update public.opportunities set review_status='approved'
where id='e1140000-0000-0000-0000-000000000011';
select set_config('request.jwt.claim.sub','e1140000-0000-0000-0000-000000000099',true);
set local role authenticated;
select is(public.release_backlog('e1140000-0000-0000-0000-000000000001',1),
  1,'bounded release fills the slot freed by review');
reset role;
select is((select queue_group::text from public.opportunities
  where id='e1140000-0000-0000-0000-000000000016'),
  'ready','highest-ranked Backlog row is released');
select is((select queue_group::text from public.opportunities
  where id='e1140000-0000-0000-0000-000000000014'),
  'backlog','release leaves the next Backlog row in place');
select is((select count(*)::integer from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001'
    and queue_group='ready' and review_status in ('new','in_review')),
  2,'release keeps the pending window bounded');
select is((select array_agg(first_ready_rank order by first_ready_rank) from public.opportunities
  where job_id='e1140000-0000-0000-0000-000000000001' and first_ready),
  array[1,2],'release does not rewrite first-ready evidence');

select * from finish();
rollback;
