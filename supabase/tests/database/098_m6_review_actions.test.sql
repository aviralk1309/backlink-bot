begin;
select plan(32);

insert into auth.users(id,email) values
  ('94000000-0000-0000-0000-000000000001','review-admin@tests.local'),
  ('94000000-0000-0000-0000-000000000002','review-manager@tests.local'),
  ('94000000-0000-0000-0000-000000000003','review-viewer@tests.local');
update public.profiles set status='active',full_name='Review Admin',
  role_id='a0000000-0000-0000-0000-000000000001'
  where id='94000000-0000-0000-0000-000000000001';
update public.profiles set status='active',full_name='Review Manager',
  role_id='a0000000-0000-0000-0000-000000000002'
  where id='94000000-0000-0000-0000-000000000002';
update public.profiles set status='active',full_name='Review Viewer',
  role_id='a0000000-0000-0000-0000-000000000003'
  where id='94000000-0000-0000-0000-000000000003';
insert into public.jobs(id,name) values ('94000000-0000-0000-0000-000000000004','Review actions test');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,filter_reason,score,tier) values
  ('94000000-0000-0000-0000-000000000011','94000000-0000-0000-0000-000000000004',
   'https://review.example/1','https://review.example/1','review.example','review.example',
   'seed_list',1,'ready',null,77,'high'),
  ('94000000-0000-0000-0000-000000000012','94000000-0000-0000-0000-000000000004',
   'https://review.example/2','https://review.example/2','review.example','review.example',
   'seed_list',1,'ready',null,60,'medium'),
  ('94000000-0000-0000-0000-000000000013','94000000-0000-0000-0000-000000000004',
   'https://review.example/3','https://review.example/3','review.example','review.example',
   'seed_list',1,'ready',null,50,'low'),
  ('94000000-0000-0000-0000-000000000014','94000000-0000-0000-0000-000000000004',
   'https://review.example/4','https://review.example/4','review.example','review.example',
   'seed_list',1,'auto_filtered','spam',null,null);
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where score is not null and job_id='94000000-0000-0000-0000-000000000004';

select ok(exists(select 1 from public.role_permissions where role_id='a0000000-0000-0000-0000-000000000001'
  and permission_key='results.reopen'),'Admin can reopen');
select ok(not exists(select 1 from public.role_permissions where role_id='a0000000-0000-0000-0000-000000000002'
  and permission_key='results.reopen'),'Manager cannot reopen by default');
select ok(not has_function_privilege('anon','public.review_opportunities(uuid,jsonb,text,text,text)','execute'),
  'anonymous review calls are closed');

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":0}]','claim'),
  'saved','reviewer soft-claims a new row');
select is((select reviewer_name from public.result_review_state(array['94000000-0000-0000-0000-000000000011'::uuid])),
  'Review Manager','claimant name is visible without users.manage');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":0}]','approve'),
  'stale','stale reviewer cannot overwrite the claim');
select throws_ok($$select public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":1}]','reject','other')$$,
  '22023','invalid_review_request','other rejection needs a decision note');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":1}]','reject','spam','Evidence'),
  'saved','reviewer rejects with a reason');
reset role;
select ok((select reject_scope='global' and reviewed_at is not null and score_at_review=77
  and notes='Evidence' from public.opportunities where id='94000000-0000-0000-0000-000000000011'),
  'spam rejection has required scope and decision snapshot');

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":2}]','reopen')$$,
  '42501','permission_denied','ordinary reviewer cannot reopen a decision');
reset role;

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":2}]','reopen'),
  'saved','Admin reopens a decision');
reset role;
select ok((select review_status='in_review' and reject_reason is null and reject_scope is null
  and reviewed_at is null and notes='Evidence' from public.opportunities
  where id='94000000-0000-0000-0000-000000000011'),
  'reopen clears the decision while preserving notes');
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":3}]','approve'),
  'saved','reopened row can be approved');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":4}]','used'),
  'saved','approved row can be marked used');
reset role;
select is((select row_version from public.opportunities where id='94000000-0000-0000-0000-000000000011'),
  5::bigint,'every transition advances the version');
select is((select count(*)::integer from public.opportunity_reviews
  where opportunity_id='94000000-0000-0000-0000-000000000011'),5,'all transitions are audited');
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000011","version":5}]','approve'),
  'invalid_state','Used cannot be approved again');
reset role;

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":0}]','claim'),
  'saved','second row claimed');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000013","version":0}]','claim'),
  'saved','third row claimed');
select throws_ok($$select public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":1},{"id":"94000000-0000-0000-0000-000000000012","version":1}]','approve')$$,
  '22023','invalid_review_request','a bulk request cannot repeat one row');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000003',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":1}]','approve'),
  'missing','rows cannot be reviewed through a different job');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":1},{"id":"94000000-0000-0000-0000-000000000013","version":0}]','approve'),
  'stale','bulk decision rejects one stale row');
reset role;
select is((select count(*)::integer from public.opportunities where id in
  ('94000000-0000-0000-0000-000000000012','94000000-0000-0000-0000-000000000013')
  and review_status='in_review'),2,'bulk conflict changes no rows');
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":1},{"id":"94000000-0000-0000-0000-000000000013","version":1}]','approve'),
  'saved','bulk approval succeeds atomically');
reset role;
select is((select count(*)::integer from public.opportunities where id in
  ('94000000-0000-0000-0000-000000000012','94000000-0000-0000-0000-000000000013')
  and review_status='approved'),2,'both bulk rows approved');

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":2}]','reopen'),
  'saved','first bulk row reopened');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000013","version":2}]','reopen'),
  'saved','second bulk row reopened');
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000012","version":3},{"id":"94000000-0000-0000-0000-000000000013","version":3}]','reject','off_topic','Shared reason'),
  'saved','bulk rejection uses one reason and note');
reset role;
select is((select count(*)::integer from public.opportunities where id in
  ('94000000-0000-0000-0000-000000000012','94000000-0000-0000-0000-000000000013')
  and review_status='rejected' and reject_scope='niche' and notes='Shared reason'),
  2,'both bulk rows retain shared reason and matching scope');

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is((select reviewer_name from public.result_review_state(array['94000000-0000-0000-0000-000000000012'::uuid])),
  'Review Admin','viewer sees claimant only for visible result');
select throws_ok($$select public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000014","version":0}]','claim')$$,
  '42501','permission_denied','viewer cannot review');
reset role;
delete from public.role_permissions where role_id='a0000000-0000-0000-0000-000000000002'
  and permission_key='results.view_filtered';
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('94000000-0000-0000-0000-000000000004',
  '[{"id":"94000000-0000-0000-0000-000000000014","version":0}]','claim'),
  'missing','reviewer cannot claim a hidden filtered row');
reset role;

select * from finish();
rollback;
