begin;
select plan(30);

insert into public.roles(id,name) values
  ('95000000-0000-0000-0000-000000000001','Reports only'),
  ('95000000-0000-0000-0000-000000000002','No reports');
insert into public.role_permissions(role_id,permission_key) values
  ('95000000-0000-0000-0000-000000000001','reports.view');
insert into auth.users(id,email) values
  ('95000000-0000-0000-0000-000000000011','reports-only@tests.local'),
  ('95000000-0000-0000-0000-000000000012','no-reports@tests.local');
update public.profiles set status='active',role_id='95000000-0000-0000-0000-000000000001'
  where id='95000000-0000-0000-0000-000000000011';
update public.profiles set status='active',role_id='95000000-0000-0000-0000-000000000002'
  where id='95000000-0000-0000-0000-000000000012';

insert into public.jobs(id,name,review_queue_size) values
  ('95000000-0000-0000-0000-000000000101','Report A',100),
  ('95000000-0000-0000-0000-000000000102','Report B',50);
insert into public.job_queries(id,job_id,activity_key,template_id,template_version,query_text) values
  ('95000000-0000-0000-0000-000000000201','95000000-0000-0000-0000-000000000101','guest_post','t1',1,'guest post'),
  ('95000000-0000-0000-0000-000000000202','95000000-0000-0000-0000-000000000101','guest_post','t1',1,'write for us'),
  ('95000000-0000-0000-0000-000000000203','95000000-0000-0000-0000-000000000101','guest_post','t2',1,'contribute'),
  ('95000000-0000-0000-0000-000000000204','95000000-0000-0000-0000-000000000101','guest_post','t2',2,'contribute 2'),
  ('95000000-0000-0000-0000-000000000205','95000000-0000-0000-0000-000000000102','guest_post','t1',1,'second job'),
  ('95000000-0000-0000-0000-000000000206','95000000-0000-0000-0000-000000000102','guest_post','foreign',1,'foreign job');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,check_status,score,tier,
  activity_key,first_ready,first_ready_rank) values
  ('95000000-0000-0000-0000-000000000301','95000000-0000-0000-0000-000000000101','https://report.example/1','https://report.example/1','report.example','report.example','google',1,'ready','done',90,'high','guest_post',true,1),
  ('95000000-0000-0000-0000-000000000302','95000000-0000-0000-0000-000000000101','https://report.example/2','https://report.example/2','report.example','report.example','google',1,'ready','done',70,'medium','guest_post',true,2),
  ('95000000-0000-0000-0000-000000000303','95000000-0000-0000-0000-000000000101','https://report.example/3','https://report.example/3','report.example','report.example','seed_list',1,'ready','done',50,'low','directory',true,3),
  ('95000000-0000-0000-0000-000000000304','95000000-0000-0000-0000-000000000101','https://report.example/4','https://report.example/4','report.example','report.example','google',1,'ready','done',80,'high','guest_post',true,51),
  ('95000000-0000-0000-0000-000000000305','95000000-0000-0000-0000-000000000101','https://report.example/5','https://report.example/5','report.example','report.example','competitor_csv',1,'backlog','done',60,'medium','directory',false,null),
  ('95000000-0000-0000-0000-000000000306','95000000-0000-0000-0000-000000000102','https://report.example/6','https://report.example/6','report.example','report.example','google',1,'ready','done',65,'medium','guest_post',true,1);
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where job_id in ('95000000-0000-0000-0000-000000000101',
    '95000000-0000-0000-0000-000000000102');
insert into public.opportunity_sources(opportunity_id,source_type,source_ref) values
  ('95000000-0000-0000-0000-000000000301','google','95000000-0000-0000-0000-000000000201'),
  ('95000000-0000-0000-0000-000000000301','google','95000000-0000-0000-0000-000000000202'),
  ('95000000-0000-0000-0000-000000000301','google','95000000-0000-0000-0000-000000000206'),
  ('95000000-0000-0000-0000-000000000301','competitor_csv','rival'),
  ('95000000-0000-0000-0000-000000000302','google','95000000-0000-0000-0000-000000000203'),
  ('95000000-0000-0000-0000-000000000303','seed_list','seed'),
  ('95000000-0000-0000-0000-000000000304','google','95000000-0000-0000-0000-000000000204'),
  ('95000000-0000-0000-0000-000000000305','competitor_csv','rival'),
  ('95000000-0000-0000-0000-000000000306','google','95000000-0000-0000-0000-000000000205');

update public.opportunities set reviewer_id='95000000-0000-0000-0000-000000000011',
  review_status='in_review' where id in (
    '95000000-0000-0000-0000-000000000301',
    '95000000-0000-0000-0000-000000000302',
    '95000000-0000-0000-0000-000000000304',
    '95000000-0000-0000-0000-000000000305',
    '95000000-0000-0000-0000-000000000306');
update public.opportunities set review_status='approved' where id in (
    '95000000-0000-0000-0000-000000000301',
    '95000000-0000-0000-0000-000000000304',
    '95000000-0000-0000-0000-000000000305',
    '95000000-0000-0000-0000-000000000306');
update public.opportunities set review_status='rejected',reject_reason='spam',reject_scope='global'
  where id='95000000-0000-0000-0000-000000000302';
update public.opportunities set review_status='used' where id in (
    '95000000-0000-0000-0000-000000000305',
    '95000000-0000-0000-0000-000000000306');
update public.opportunities set score=30,tier='low'
  where id='95000000-0000-0000-0000-000000000301';

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000011',true);
set local role authenticated;
select is((select decided_count from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='top_50'),2::bigint,'job A top 50 excludes rank 51 and backlog');
select is((select approval_rate from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='top_50'),0.5000::numeric,'job A top 50 is 1 of 2');
select is((select undecided_count from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='top_50'),1::bigint,'top 50 retains undecided count');
select is((select approval_rate from public.report_metrics('95000000-0000-0000-0000-000000000102')
  where dimension='top_50'),1.0000::numeric,'only Used is approved for the headline');
select is((select approval_rate from public.report_metrics() where dimension='top_50'),
  0.6667::numeric,'overall top 50 is weighted by decided rows, not job averages');
select ok((select approved_count=2 and used_count=2 and rejected_count=1
  and undecided_count=1 and decided_count=5 from public.report_metrics()
  where dimension='all_results'), 'all reviewable rows have a separate summary');
select ok((select low_sample from public.report_metrics() where dimension='top_50'),
  'three decisions trigger the below-20 warning');
select ok((select approved_count=2 and rejected_count=1 and decided_count=3
  from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='source' and dimension_key='google'),
  'source counts one opportunity once even if two Google queries found it');
select ok((select approved_count=1 and used_count=1 and decided_count=2
  from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='source' and dimension_key='competitor_csv'),
  'multi-source opportunity contributes to each distinct source');
select ok((select approved_count=1 and used_count=1 and decided_count=2
  from public.report_metrics() where dimension='query_template' and dimension_key='guest_post/t1'),
  'template attribution combines jobs and deduplicates repeated query matches');
select is((select count(*) from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='query_template' and dimension_key='guest_post/foreign'),0::bigint,
  'foreign-job query references cannot misattribute a template');
select is((select approval_rate from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='query_template' and dimension_key='guest_post/t2'),
  0.5000::numeric,'template rate combines versions of the same template');
select ok((select approved_count=2 and rejected_count=1 and used_count=0
  from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='activity' and dimension_key='guest_post'),
  'activity counts current decisions');
select is((select approved_count from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='tier' and dimension_key='high'),2::bigint,
  'tier uses the review snapshot after a rescore');
select ok((select decided_count=0 and approval_rate is null and low_sample
  from public.report_metrics('95000000-0000-0000-0000-000000000101')
  where dimension='source' and dimension_key='seed_list'),
  'zero decisions produce null rate and a low-sample warning');
select ok((select rejected_count=1 from public.report_reject_reasons()
  where reject_reason='spam'), 'current spam rejection is counted');
select is((select sum(rejected_count) from public.report_reject_reasons()),1::numeric,
  'other reason buckets remain zero');
select ok((select approved_count=4 and rejected_count=1 and decided_count=5
  from public.report_review_throughput()),
  'throughput counts approval/rejection events, not Used follow-ups');
select is((select decided_count from public.report_review_throughput('95000000-0000-0000-0000-000000000102')),
  1::bigint,'throughput filters by job');
select ok((select decided_count=0 and undecided_count=1 and approval_rate is null
  from public.report_metrics('95000000-0000-0000-0000-000000000101',
    p_from=>(current_date + 1)::date) where dimension='top_50'),
  'future decision period excludes decisions but keeps current pending');
select is((select decided_count from public.report_metrics(p_activity=>'directory')
  where dimension='all_results'),1::bigint,'activity filter narrows metrics');
select is((select count(*) from public.report_review_throughput(
  p_from=>(current_date + 1)::date)),0::bigint,
  'throughput filters by decision day');
select throws_ok($$select * from public.report_metrics(p_from=>'2026-10-31',p_to=>'2026-10-01')$$,
  '22023','invalid_report_period','reversed reporting period is rejected');
select ok((select decided_count=0 and approval_rate is null and low_sample
  from public.report_metrics('95000000-0000-0000-0000-000000000999')
  where dimension='top_50'), 'empty job still returns a zero-denominator headline');
reset role;
select ok(not has_table_privilege('authenticated','public.job_queries','insert')
  and not has_table_privilege('authenticated','public.job_queries','update')
  and has_table_privilege('worker','public.job_queries','insert'),
  'clients cannot forge query records; the worker can generate them');
select ok(not has_function_privilege('anon','public.report_metrics(uuid,date,date,text)','execute')
  and not has_function_privilege('worker','public.report_metrics(uuid,date,date,text)','execute'),
  'only authenticated callers can request aggregates');

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000011',true);
set local role authenticated;
select is((select count(*)::integer from public.opportunities),0,
  'reports-only role cannot read result rows directly');
select is((select count(*)::integer from public.job_queries),0,
  'reports-only role cannot read query text directly');
select is((select approval_rate from public.report_metrics() where dimension='top_50'),
  0.6667::numeric,'reports-only role can read aggregate metrics');
reset role;
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000012',true);
set local role authenticated;
select throws_ok($$select * from public.report_metrics()$$,
  '42501','permission_denied','role without reports.view is denied');
reset role;

select * from finish();
rollback;
