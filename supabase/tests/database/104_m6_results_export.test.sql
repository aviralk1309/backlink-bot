begin;
select plan(20);

select ok(not has_function_privilege('anon',
  'public.export_result_batch(uuid,public.opportunity_queue_group,public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,uuid,integer)',
  'execute'),'anonymous cannot read export batches');
select ok(not has_function_privilege('worker',
  'public.export_result_batch(uuid,public.opportunity_queue_group,public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,uuid,integer)',
  'execute'),'worker cannot read export batches');
select ok(not has_function_privilege('anon',
  'public.log_result_export(uuid,jsonb,text[])','execute'),'anonymous cannot log exports');

insert into public.roles(id,name) values
  ('96000000-0000-0000-0000-000000000201','S7 exporter');
insert into public.role_permissions(role_id,permission_key) values
  ('96000000-0000-0000-0000-000000000201','jobs.view'),
  ('96000000-0000-0000-0000-000000000201','results.view'),
  ('96000000-0000-0000-0000-000000000201','results.export');
insert into auth.users(id,email) values
  ('96000000-0000-0000-0000-000000000202','export-admin@tests.local'),
  ('96000000-0000-0000-0000-000000000203','export-viewer@tests.local'),
  ('96000000-0000-0000-0000-000000000204','export-custom@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='96000000-0000-0000-0000-000000000202';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='96000000-0000-0000-0000-000000000203';
update public.profiles set status='active',role_id='96000000-0000-0000-0000-000000000201'
  where id='96000000-0000-0000-0000-000000000204';
insert into public.jobs(id,name) values
  ('96000000-0000-0000-0000-000000000210','S7 export job');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,filter_reason,score,tier,external_metrics) values
  ('96000000-0000-0000-0000-000000000211','96000000-0000-0000-0000-000000000210','https://export.example/1','https://export.example/1','export.example','export.example','google',1,'ready',null,80,'high','{}'),
  ('96000000-0000-0000-0000-000000000212','96000000-0000-0000-0000-000000000210','https://export.example/2','https://export.example/2','export.example','export.example','seed_list',1,'ready',null,60,'medium','{}'),
  ('96000000-0000-0000-0000-000000000213','96000000-0000-0000-0000-000000000210','https://export.example/3','https://export.example/3','export.example','export.example','seed_list',1,'backlog',null,50,'low','{}'),
  ('96000000-0000-0000-0000-000000000214','96000000-0000-0000-0000-000000000210','https://export.example/4','https://export.example/4','export.example','export.example','seed_list',1,'auto_filtered','spam',null,null,'{}');
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where score is not null and job_id='96000000-0000-0000-0000-000000000210';
insert into public.opportunity_sources(opportunity_id,source_type,source_ref) values
  ('96000000-0000-0000-0000-000000000211','google','q1'),
  ('96000000-0000-0000-0000-000000000212','seed_list','s1');
update public.opportunities set external_metrics='{"dr":42}'::jsonb
  where id='96000000-0000-0000-0000-000000000211';

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000203',true);
set local role authenticated;
select throws_ok($$select * from public.export_result_batch('96000000-0000-0000-0000-000000000210')$$,
  '42501','permission_denied','Viewer cannot read export batches');
select throws_ok($$select public.log_result_export('96000000-0000-0000-0000-000000000210','{}','{domain}')$$,
  '42501','permission_denied','Viewer cannot log an export');

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000204',true);
select is((select count(*)::integer from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_queue=>null)),3,
  'exporter without filtered access sees only visible rows');
select throws_ok($$select * from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_queue=>'auto_filtered')$$,
  '42501','permission_denied','filtered queue stays hidden without its permission');

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000202',true);
select is((select external_metrics->>'dr' from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_source=>'google')),'42',
  'export includes external metrics');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000210',
  '[{"id":"96000000-0000-0000-0000-000000000211","version":1}]','claim'),
  'saved','fixture result claimed');
select is(public.review_opportunities('96000000-0000-0000-0000-000000000210',
  '[{"id":"96000000-0000-0000-0000-000000000211","version":2}]','approve'),
  'saved','fixture result approved');
select is((select count(*)::integer from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210')),2,
  'default export uses the Ready queue');
select is((select count(*)::integer from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_source=>'google')),1,
  'source filter matches Results screen');
select is((select count(*)::integer from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_after=>'96000000-0000-0000-0000-000000000211')),1,
  'id cursor advances without repeating the first row');
select is((select count(*)::integer from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_status=>'approved')),1,
  'chosen status filters exported rows');
select is((select count(*)::integer from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_queue=>null)),4,
  'Admin All export includes filtered rows');
select throws_ok($$select * from public.export_result_batch(
  '96000000-0000-0000-0000-000000000210',p_limit=>501)$$,
  '22023','invalid_results_filter','oversized page is rejected');
select lives_ok($$select public.log_result_export('96000000-0000-0000-0000-000000000210',
  '{"queue":"ready","status":"approved"}','{normalized_url,dr}')$$,
  'authorized export is logged');
reset role;
select is((select count(*)::integer from public.job_events where
  job_id='96000000-0000-0000-0000-000000000210' and type='results_export_started'),1,
  'one export event is written');
select ok((select payload->'filters'->>'status'='approved'
  and payload->'columns'='["normalized_url","dr"]'::jsonb
  and actor='96000000-0000-0000-0000-000000000202'
  from public.job_events where type='results_export_started'),
  'event records actor, filters, and selected columns');
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000202',true);
set local role authenticated;
select throws_ok($$select public.log_result_export('96000000-0000-0000-0000-000000000210',
  '{}','{}')$$,'22023','invalid_export_request','empty column list is rejected');
reset role;

select * from finish();
rollback;
