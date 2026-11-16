begin;
select plan(16);

insert into auth.users(id,email) values
  ('b7000000-0000-0000-0000-000000000001','capture-admin@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='b7000000-0000-0000-0000-000000000001';
insert into public.jobs(id,name) values
  ('b7000000-0000-0000-0000-000000000011','Decision capture test');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,score,tier) values
  ('b7000000-0000-0000-0000-000000000021','b7000000-0000-0000-0000-000000000011',
   'https://capture.example/one','https://capture.example/one','capture.example','capture.example',
   'seed_list',1,'ready',null,null),
  ('b7000000-0000-0000-0000-000000000022','b7000000-0000-0000-0000-000000000011',
   'https://capture.example/two','https://capture.example/two','capture.example','capture.example',
   'seed_list',1,'ready',70,'medium'),
  ('b7000000-0000-0000-0000-000000000023','b7000000-0000-0000-0000-000000000011',
   'https://capture.example/three','https://capture.example/three','capture.example','capture.example',
   'seed_list',1,'ready',0,'unchecked'),
  ('b7000000-0000-0000-0000-000000000024','b7000000-0000-0000-0000-000000000011',
   'https://capture.example/four','https://capture.example/four','capture.example','capture.example',
   'seed_list',1,'ready',60,'medium');
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where id='b7000000-0000-0000-0000-000000000023';
update public.opportunities set score_breakdown='{"components":[]}'::jsonb
  where id='b7000000-0000-0000-0000-000000000024';

select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000021","version":0}]','claim'),
  'saved','an unscored result can still be claimed');
select throws_ok($$select public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000021","version":1}]','approve')$$,
  '23514','review_scoring_missing','a decision without a score is rejected');
select is(public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000022","version":0}]','claim'),
  'saved','a scored result without details can be claimed');
select throws_ok($$select public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000022","version":1}]','reject','spam')$$,
  '23514','review_scoring_missing','a decision without scoring details is rejected');
select is(public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000024","version":0}]','claim'),
  'saved','an incomplete feature vector can be claimed');
select throws_ok($$select public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000024","version":1}]','approve')$$,
  '23514','review_scoring_missing','an incomplete feature vector is rejected');
select is(public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000023","version":0}]','claim'),
  'saved','a zero-score result can be claimed');
select is(public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000023","version":1}]','approve'),
  'saved','zero is a valid review score');
reset role;
select ok((select score=0 and scoring_inputs->'components'->0->>'component'='relevance'
  from public.opportunity_reviews where opportunity_id='b7000000-0000-0000-0000-000000000023'
    and to_status='approved'), 'approval history freezes the scoring inputs');

update public.opportunities set score=40,tier='low',
  score_breakdown=jsonb_set(score_breakdown,'{components,0,raw}','0.5'::jsonb)
  where id='b7000000-0000-0000-0000-000000000023';
select ok((select score=0 and scoring_inputs->'components'->0->>'raw'='0'
  from public.opportunity_reviews where opportunity_id='b7000000-0000-0000-0000-000000000023'
    and to_status='approved'), 'later rescoring does not rewrite the approval snapshot');

select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000023","version":2}]','used'),
  'saved','Used captures the then-current score as before');
reset role;
select ok((select score=40 and scoring_inputs->'components'->0->>'raw'='0.5'
  from public.opportunity_reviews where opportunity_id='b7000000-0000-0000-0000-000000000023'
    and to_status='used'), 'Used has its own immutable scoring snapshot');
select throws_ok($$update public.opportunities set score=80,review_status='approved',
  reviewer_id='b7000000-0000-0000-0000-000000000001'
  where id='b7000000-0000-0000-0000-000000000024'$$,
  '23514','review_scoring_changed_with_decision',
  'scoring and decision changes cannot share one update');

update public.opportunities set score_breakdown=(select score_breakdown
  from public.opportunities where id='b7000000-0000-0000-0000-000000000023')
  where id='b7000000-0000-0000-0000-000000000024';
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.review_opportunities('b7000000-0000-0000-0000-000000000011',
  '[{"id":"b7000000-0000-0000-0000-000000000021","version":1},
    {"id":"b7000000-0000-0000-0000-000000000024","version":1}]','approve')$$,
  '23514','review_scoring_missing','one unscored row aborts a bulk decision');
reset role;
select ok((select count(*)=2 from public.opportunities where id in
  ('b7000000-0000-0000-0000-000000000021','b7000000-0000-0000-0000-000000000024')
  and review_status='in_review'), 'bulk failure leaves every selected row undecided');
select is((select count(*)::integer from public.opportunity_reviews
  where to_status='approved' and opportunity_id='b7000000-0000-0000-0000-000000000024'),
  0,'failed bulk decision records no partial approval history');

select * from finish();
rollback;
