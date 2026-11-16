begin;
select plan(26);

insert into auth.users(id,email) values
  ('95000000-0000-0000-0000-000000000001','scope-manager@tests.local'),
  ('95000000-0000-0000-0000-000000000002','scope-admin@tests.local');
update public.profiles set status='active',
  role_id='a0000000-0000-0000-0000-000000000002'
  where id='95000000-0000-0000-0000-000000000001';
update public.profiles set status='active',
  role_id='a0000000-0000-0000-0000-000000000001'
  where id='95000000-0000-0000-0000-000000000002';
insert into public.jobs(id,name,business_type,sub_niche,skip_previously_spam_domains) values
  ('95000000-0000-0000-0000-000000000011','Esports',' Esports ','Competitive  Gaming',false),
  ('95000000-0000-0000-0000-000000000012','Same niche','esports','competitive gaming',false),
  ('95000000-0000-0000-0000-000000000013','Travel','Travel','Adventure',false),
  ('95000000-0000-0000-0000-000000000014','Skip spam','Travel','Adventure',true);
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version) values
  ('95000000-0000-0000-0000-000000000021','95000000-0000-0000-0000-000000000011',
   'https://topic.example/1','https://topic.example/1','topic.example','topic.example','seed_list',1),
  ('95000000-0000-0000-0000-000000000022','95000000-0000-0000-0000-000000000011',
   'https://spam.example/1','https://spam.example/1','spam.example','spam.example','seed_list',1),
  ('95000000-0000-0000-0000-000000000023','95000000-0000-0000-0000-000000000011',
   'https://spam.example/2','https://spam.example/2','spam.example','spam.example','seed_list',1),
  ('95000000-0000-0000-0000-000000000024','95000000-0000-0000-0000-000000000011',
   'https://other.example/1','https://other.example/1','other.example','other.example','seed_list',1);
update public.opportunities set score=0,tier='unchecked',
  score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
    (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
      'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where job_id='95000000-0000-0000-0000-000000000011';

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000021","version":0}]','claim'),
  'saved','off-topic row claimed');
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000021","version":1}]','reject','off_topic'),
  'saved','off-topic rejection saved');
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000022","version":0}]','claim'),
  'saved','first spam row claimed');
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000022","version":1}]','reject','spam'),
  'saved','first spam rejection saved');
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000023","version":0}]','claim'),
  'saved','second spam row claimed');
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000023","version":1}]','reject','spam'),
  'saved','second spam rejection saved');
reset role;

select ok(exists(select 1 from public.domain_niche_rejections
  where opportunity_id='95000000-0000-0000-0000-000000000021'
    and business_type='esports' and sub_niche='competitive gaming'),
  'niche key is normalized and stored with the live decision');
select ok((select global_spam and global_spam_at is not null
  from public.domains where registered_domain='spam.example'),
  'spam rejection sets the global domain flag');

update public.jobs set business_type='Changed after review', sub_niche='Different'
  where id='95000000-0000-0000-0000-000000000011';

select public.record_discovery('95000000-0000-0000-0000-000000000012',
  'https://topic.example/same','https://topic.example/same','topic.example','topic.example','google','q1');
select public.record_discovery('95000000-0000-0000-0000-000000000013',
  'https://topic.example/travel','https://topic.example/travel','topic.example','topic.example','google','q1');
select public.record_discovery('95000000-0000-0000-0000-000000000013',
  'https://spam.example/future','https://spam.example/future','spam.example','spam.example','google','q1');
select public.record_discovery('95000000-0000-0000-0000-000000000014',
  'https://spam.example/skip','https://spam.example/skip','spam.example','spam.example','google','q1');
select ok((select flags->>'previously_off_topic'='true'
  from public.opportunities where normalized_url='https://topic.example/same'),
  'same niche gets an informational off-topic flag');
select ok((select flags = '{}'::jsonb
  from public.opportunities where normalized_url='https://topic.example/travel'),
  'travel job is never flagged by an esports rejection');
select ok((select flags->>'previously_spam'='true' and check_status='pending'
  from public.opportunities where normalized_url='https://spam.example/future'),
  'spam flags future jobs without skipping when skip option is off');
select ok((select flags->>'previously_spam'='true' and filter_reason='previously_spam'
  from public.opportunities where normalized_url='https://spam.example/skip'),
  'skip option auto-filters future spam-domain results');

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000024","version":0}]','claim'),
  'saved','job-scoped row claimed');
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000024","version":1}]','reject','no_link_option'),
  'saved','job-scoped rejection saved');
reset role;
select ok((select reject_scope='job' from public.opportunities
  where id='95000000-0000-0000-0000-000000000024')
  and not exists(select 1 from public.domains where registered_domain='other.example' and global_spam)
  and not exists(select 1 from public.domain_niche_rejections where domain='other.example'),
  'ordinary rejection creates no cross-job flag');

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000022","version":2}]','reopen'),
  'saved','first spam rejection reopened');
reset role;
select ok((select global_spam from public.domains where registered_domain='spam.example'),
  'another live spam rejection keeps the global flag');
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000023","version":2}]','reopen'),
  'saved','last spam rejection reopened');
reset role;
select ok((select not global_spam and global_spam_at is null
  from public.domains where registered_domain='spam.example'),
  'undoing the last spam rejection removes the global flag');

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000021","version":2}]','reopen'),
  'saved','off-topic rejection reopened');
reset role;
select is((select count(*)::integer from public.domain_niche_rejections
  where domain='topic.example'),0,'last niche flag is removed');
select public.record_discovery('95000000-0000-0000-0000-000000000012',
  'https://topic.example/after-undo','https://topic.example/after-undo',
  'topic.example','topic.example','google','q2');
select ok((select flags = '{}'::jsonb
  from public.opportunities where normalized_url='https://topic.example/after-undo'),
  'future finds lose the undone niche flag');
select ok((select flags->>'previously_off_topic'='true'
  from public.opportunities where normalized_url='https://topic.example/same'),
  'earlier discovery snapshot keeps its historical flag');

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.review_opportunities('95000000-0000-0000-0000-000000000011',
  '[{"id":"95000000-0000-0000-0000-000000000022","version":3}]','reject','spam'),
  'saved','reopened result can be rejected again');
reset role;
select ok((select global_spam from public.domains where registered_domain='spam.example'),
  'new live spam rejection restores the flag');
delete from public.jobs where id='95000000-0000-0000-0000-000000000011';
select ok((select not global_spam from public.domains where registered_domain='spam.example'),
  'deleting the last spam-rejecting job clears the flag');

select * from finish();
rollback;
