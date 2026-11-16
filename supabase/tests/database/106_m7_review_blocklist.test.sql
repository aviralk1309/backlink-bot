begin;
select plan(13);

insert into auth.users(id,email) values
  ('a6000000-0000-0000-0000-000000000001','block-admin@tests.local'),
  ('a6000000-0000-0000-0000-000000000002','block-viewer@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='a6000000-0000-0000-0000-000000000001';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='a6000000-0000-0000-0000-000000000002';
insert into public.jobs(id,name) values
  ('a6000000-0000-0000-0000-000000000011','Review block source'),
  ('a6000000-0000-0000-0000-000000000012','Future discovery');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group) values
  ('a6000000-0000-0000-0000-000000000021','a6000000-0000-0000-0000-000000000011',
   'https://bad.example/one','https://bad.example/one','bad.example','bad.example','seed_list',1,'ready'),
  ('a6000000-0000-0000-0000-000000000022','a6000000-0000-0000-0000-000000000011',
   'https://bad.example/two','https://bad.example/two','bad.example','bad.example','seed_list',1,'ready'),
  ('a6000000-0000-0000-0000-000000000023','a6000000-0000-0000-0000-000000000011',
   'https://other.example/one','https://other.example/one','other.example','other.example','seed_list',1,'ready'),
  ('a6000000-0000-0000-0000-000000000024','a6000000-0000-0000-0000-000000000011',
   'https://pending.example/one','https://pending.example/one','pending.example','pending.example','seed_list',1,'ready');
update public.opportunities set score=0,tier='unchecked',
  score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
    (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
      'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where job_id='a6000000-0000-0000-0000-000000000011';
update public.opportunities set review_status='rejected',
  reviewer_id='a6000000-0000-0000-0000-000000000001',
  reject_reason='no_link_option',reject_scope='job'
  where id in ('a6000000-0000-0000-0000-000000000021',
               'a6000000-0000-0000-0000-000000000022',
               'a6000000-0000-0000-0000-000000000023');

select ok(has_function_privilege('authenticated',
  'public.block_rejected_domain(uuid,uuid,text,text)','execute')
  and not has_function_privilege('anon',
  'public.block_rejected_domain(uuid,uuid,text,text)','execute')
  and not has_function_privilege('worker',
  'public.block_rejected_domain(uuid,uuid,text,text)','execute'),
  'only authenticated callers can invoke the review block action');

select set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select * from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000011',
  'a6000000-0000-0000-0000-000000000021',null,'Viewer block')$$,
  '42501','permission_denied','viewer cannot add a global block');
reset role;

select set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select * from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000011',null,null,'No source')$$,
  '22023','invalid_block_request','a rejected source is required');
select is((select outcome from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000011',
  'a6000000-0000-0000-0000-000000000024',null,'Pending result')),
  'not_rejected','an undecided result cannot create a block');
select is((select outcome from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000012',
  'a6000000-0000-0000-0000-000000000021',null,'Wrong job')),
  'not_rejected','the rejected result must belong to the source job');
select is((select outcome from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000011',
  'a6000000-0000-0000-0000-000000000021',null,'  Review decision  ')),
  'added','a rejected row can add its domain');
reset role;
select ok((select reason='Review decision'
  and source_job_id='a6000000-0000-0000-0000-000000000011'
  and added_by='a6000000-0000-0000-0000-000000000001'
  from public.blocklist where domain='bad.example'),
  'block records the reason, source job, and actor');

select set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select outcome from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000011',
  'a6000000-0000-0000-0000-000000000022',null,'Overwrite')),
  'already_blocked','duplicate block is reported without replacement');
select is((select outcome from public.block_rejected_domain(
  'a6000000-0000-0000-0000-000000000011',null,'other.example','Domain group')),
  'added','a domain group can add a block through a rejected member');
reset role;
select is((select reason from public.blocklist where domain='bad.example'),
  'Review decision','duplicate action preserves the first reason');
select is((select count(*)::integer from public.blocklist where domain='pending.example'),
  0,'undecided domains remain unblocked');
select is((select review_status::text from public.opportunities
  where id='a6000000-0000-0000-0000-000000000021'),
  'rejected','blocking leaves existing decisions unchanged');

select public.record_discovery('a6000000-0000-0000-0000-000000000012',
  'https://bad.example/future','https://bad.example/future',
  'bad.example','bad.example','google','q1');
select ok((select queue_group='auto_filtered' and filter_reason='blocklisted'
  from public.opportunities where normalized_url='https://bad.example/future'),
  'next discovery automatically filters a globally blocked domain');

select * from finish();
rollback;
