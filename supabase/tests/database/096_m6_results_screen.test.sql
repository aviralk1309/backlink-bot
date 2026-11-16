begin;
select plan(25);

insert into auth.users(id,email) values
  ('99000000-0000-0000-0000-000000000001','results-manager@tests.local'),
  ('99000000-0000-0000-0000-000000000002','results-viewer@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000002'
  where id='99000000-0000-0000-0000-000000000001';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='99000000-0000-0000-0000-000000000002';
insert into public.jobs(id,name) values ('99000000-0000-0000-0000-000000000003','Results screen test');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,score,tier,overlap_count,activity_key,
  created_at,flags,client_link_status,filter_reason,filter_detail) values
  ('99000000-0000-0000-0000-000000000011','99000000-0000-0000-0000-000000000003',
   'https://alpha.com/a','https://alpha.com/a','alpha.com','alpha.com',
   'competitor_csv',1,'ready',90,'high',2,'guest_post','2026-01-01',
   '{"previously_spam":true}','unknown',null,null),
  ('99000000-0000-0000-0000-000000000012','99000000-0000-0000-0000-000000000003',
   'https://beta.com/b','https://beta.com/b','beta.com','beta.com',
   'google',1,'ready',90,'high',1,'resource_page','2026-01-02',
   '{}','known_partial',null,null),
  ('99000000-0000-0000-0000-000000000013','99000000-0000-0000-0000-000000000003',
   'https://alpha.com/c','https://alpha.com/c','alpha.com','alpha.com',
   'seed_list',1,'ready',80,'medium',1,'guest_post','2026-01-03',
   '{}','unknown',null,null),
  ('99000000-0000-0000-0000-000000000014','99000000-0000-0000-0000-000000000003',
   'https://gamma.com/d','https://gamma.com/d','gamma.com','gamma.com',
   'competitor_csv',1,'backlog',70,'medium',0,null,'2026-01-04',
   '{}','unknown',null,null),
  ('99000000-0000-0000-0000-000000000015','99000000-0000-0000-0000-000000000003',
   'https://delta.com/e','https://delta.com/e','delta.com','delta.com',
   'seed_list',1,'auto_filtered',null,null,0,null,'2026-01-05',
   '{}','unknown','dead_page','Dead page');
insert into public.opportunity_sources(opportunity_id,source_type,source_ref) values
  ('99000000-0000-0000-0000-000000000011','competitor_csv','rival'),
  ('99000000-0000-0000-0000-000000000011','google','query-1'),
  ('99000000-0000-0000-0000-000000000012','google','query-2'),
  ('99000000-0000-0000-0000-000000000013','seed_list','seed'),
  ('99000000-0000-0000-0000-000000000014','competitor_csv','rival'),
  ('99000000-0000-0000-0000-000000000015','seed_list','seed');
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where score is not null and job_id='99000000-0000-0000-0000-000000000003';
update public.opportunities set review_status='approved',
  reviewer_id='99000000-0000-0000-0000-000000000001'
  where id='99000000-0000-0000-0000-000000000012';

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);
set local role authenticated;

select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_limit=>2)),'abc',
  'Ready is the default and score ties use overlap; one extra row signals next page');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_after=>'99000000-0000-0000-0000-000000000012')),
  'c','score cursor resumes after the visible row');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_sort=>'newest')),'cba',
  'newest sort reverses discovery time');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_sort=>'newest',
  p_after=>'99000000-0000-0000-0000-000000000013')),'ba',
  'newest cursor resumes without offset');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_source=>'google')),'ab',
  'source filter includes secondary discovery sources');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_activity=>'guest_post')),'ac',
  'activity filter works');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_status=>'approved')),'b',
  'review status filter works');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_tier=>'high')),'ab',
  'tier filter works');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_domain=>'alpha.com')),'ac',
  'exact domain filter works');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_query=>'beta')),'b',
  'URL/domain search works');
select is((select string_agg(right(normalized_url,1),'') from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_flag=>'previous_spam')),'a',
  'flag filter works');
select is((select source_types from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_limit=>1) limit 1),
  array['competitor_csv','google'],'source list includes every source type');
select is((select string_agg(domain||':'||result_count||':'||best_score,',')
  from public.list_job_result_domains('99000000-0000-0000-0000-000000000003',p_limit=>1)),
  'alpha.com:2:90.00,beta.com:1:90.00','domain groups show count and best score');
select is((select preview_urls from public.list_job_result_domains(
  '99000000-0000-0000-0000-000000000003',p_limit=>1) limit 1),
  array['https://alpha.com/a','https://alpha.com/c'],'group preview follows score order');
select is((select string_agg(domain,',') from public.list_job_result_domains(
  '99000000-0000-0000-0000-000000000003',p_after=>'alpha.com')),'beta.com',
  'domain cursor resumes alphabetically');
select is((select count(*)::integer from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_queue=>'auto_filtered')),1,
  'manager can open Auto-filtered');
select is((select count(*)::integer from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_queue=>null)),5,
  'manager All includes filtered rows');
select throws_ok($$select * from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_limit=>0)$$,
  '22023','invalid_results_filter','limit is bounded');
select throws_ok($$select * from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_sort=>'bad')$$,
  '22023','invalid_results_filter','sort is allowlisted');
select throws_ok($$select * from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_sort=>null)$$,
  '22023','invalid_results_filter','null sort is rejected');
select is((select count(*)::integer from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_query=>repeat(E'\\%',100))),0,
  'escaped 100-character search is accepted as a literal');

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_queue=>null)),4,
  'Viewer All excludes filtered rows through RLS');
select throws_ok($$select * from public.list_job_results(
  '99000000-0000-0000-0000-000000000003',p_queue=>'auto_filtered')$$,
  '42501','permission_denied','Viewer cannot query Auto-filtered');
select ok(not has_function_privilege('authenticated',
  'public.result_matches(uuid,public.opportunity_queue_group,public.opportunity_tier,text,text,public.opportunity_review_status,text,text,text,boolean)',
  'execute'),'internal match function is not callable from the browser');
select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000099',true);
select throws_ok($$select * from public.list_job_results(
  '99000000-0000-0000-0000-000000000003')$$,
  '42501','permission_denied','inactive caller cannot use definer query');

reset role;
select * from finish();
rollback;
