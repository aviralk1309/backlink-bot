begin;
select plan(27);

insert into auth.users(id,email) values
  ('98000000-0000-0000-0000-000000000001','reviewer@tests.local'),
  ('98000000-0000-0000-0000-000000000002','viewer-review@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000002'
  where id='98000000-0000-0000-0000-000000000001';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='98000000-0000-0000-0000-000000000002';
insert into public.jobs(id,name) values ('98000000-0000-0000-0000-000000000003','Review schema test');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,score,tier) values
  ('98000000-0000-0000-0000-000000000004','98000000-0000-0000-0000-000000000003',
   'https://review.example/a','https://review.example/a','review.example','review.example',
   'competitor_csv',1,'ready',72,'high');
insert into public.opportunity_sources(opportunity_id,source_type,source_ref) values
  ('98000000-0000-0000-0000-000000000004','competitor_csv','rival');
update public.opportunities set score_breakdown=jsonb_build_object('algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where id='98000000-0000-0000-0000-000000000004';

select is((select review_status::text from public.opportunities where id='98000000-0000-0000-0000-000000000004'),'new','new is the default');
select is((select row_version from public.opportunities where id='98000000-0000-0000-0000-000000000004'),0::bigint,'version starts at zero');
select throws_ok($$insert into public.opportunities(job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,review_status,reviewer_id) values
  ('98000000-0000-0000-0000-000000000003','https://review.example/b','https://review.example/b',
   'review.example','review.example','seed_list',1,'in_review',
   '98000000-0000-0000-0000-000000000001')$$,
  '23514','review_insert_must_be_new','reviewed rows cannot bypass the transition log on insert');
select throws_ok($$update public.opportunities set row_version=4
  where id='98000000-0000-0000-0000-000000000004'$$,
  '23514','review_snapshot_is_managed','version cannot be forged');
select throws_ok($$update public.opportunities set review_status='rejected',
  reviewer_id='98000000-0000-0000-0000-000000000001'
  where id='98000000-0000-0000-0000-000000000004'$$,
  '23514',null,'rejection requires a reason and matching scope');
select throws_ok($$update public.opportunities set review_status='rejected',
  reviewer_id='98000000-0000-0000-0000-000000000001',reject_reason='spam',reject_scope='job'
  where id='98000000-0000-0000-0000-000000000004'$$,
  '23514',null,'spam scope must be global');
select throws_ok($$update public.opportunities set review_status='rejected',
  reviewer_id='98000000-0000-0000-0000-000000000001',reject_reason='other',reject_scope='job'
  where id='98000000-0000-0000-0000-000000000004'$$,
  '23514',null,'other requires a note');
select is((select count(*)::integer from public.opportunity_reviews),0,'failed decisions leave no history');

update public.opportunities set review_status='in_review',
  reviewer_id='98000000-0000-0000-0000-000000000001'
  where id='98000000-0000-0000-0000-000000000004';
select is((select row_version from public.opportunities where id='98000000-0000-0000-0000-000000000004'),1::bigint,'status change increments version');
select is((select from_status::text||'>'||to_status::text from public.opportunity_reviews
  where opportunity_id='98000000-0000-0000-0000-000000000004'),'new>in_review','transition is audited');
update public.opportunities set review_status='rejected',reject_reason='spam',reject_scope='global',notes='Evidence'
  where id='98000000-0000-0000-0000-000000000004';
select is((select row_version from public.opportunities where id='98000000-0000-0000-0000-000000000004'),2::bigint,'decision increments version');
select ok((select reviewed_at is not null and score_at_review=72 and tier_at_review='high'
  from public.opportunities where id='98000000-0000-0000-0000-000000000004'),
  'decision snapshots score, tier and time');
select ok((select reject_reason='spam' and reject_scope='global' and score=72 and tier='high'
  and config_version=1 and queue_group='ready' and row_version=2
  and source_summary->'sources'='[{"type":"competitor_csv","ref":"rival"}]'::jsonb
  from public.opportunity_reviews where row_version=2),
  'history freezes decision and source evidence');
update public.opportunities set notes='More evidence',external_metrics='{"dr":50}'::jsonb
  where id='98000000-0000-0000-0000-000000000004';
select is((select count(*)::integer from public.opportunity_reviews),3,'metadata edits are audited');
select is((select notes from public.opportunity_reviews where row_version=3),'More evidence','history captures revised note');
update public.opportunities set score=80 where id='98000000-0000-0000-0000-000000000004';
select is((select row_version from public.opportunities where id='98000000-0000-0000-0000-000000000004'),3::bigint,'worker score edits do not change review version');
select is((select count(*)::integer from public.opportunity_reviews),3,'worker score edits do not create review history');
select ok(not has_table_privilege('authenticated','public.opportunity_reviews','insert')
  and not has_table_privilege('authenticated','public.opportunity_reviews','update')
  and not has_table_privilege('authenticated','public.opportunity_reviews','delete'),
  'browser cannot forge or rewrite history');
select ok(not has_table_privilege('worker','public.opportunity_reviews','insert'),
  'worker cannot forge history');

set local role worker;
do $$
begin
  begin
    update public.opportunities set notes='forged'
      where id='98000000-0000-0000-0000-000000000004';
    raise exception 'worker_review_allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select is((select notes from public.opportunities where id='98000000-0000-0000-0000-000000000004'),
  'More evidence','worker cannot edit review state directly');

create function pg_temp.fail_review_insert() returns trigger language plpgsql as $$
begin raise exception 'audit_unavailable' using errcode='P0001'; end;
$$;
create trigger fail_review_insert before insert on public.opportunity_reviews
  for each row execute function pg_temp.fail_review_insert();
select throws_ok($$update public.opportunities set notes='lost'
  where id='98000000-0000-0000-0000-000000000004'$$,
  'P0001','audit_unavailable','audit failure rolls back the review update');
drop trigger fail_review_insert on public.opportunity_reviews;
select is((select notes from public.opportunities where id='98000000-0000-0000-0000-000000000004'),
  'More evidence','review remains unchanged after audit failure');
select is((select count(*)::integer from public.opportunity_reviews),3,'failed audit leaves no history row');

insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,filter_reason,filter_detail) values
  ('98000000-0000-0000-0000-000000000005','98000000-0000-0000-0000-000000000003',
   'https://review.example/filtered','https://review.example/filtered','review.example',
   'review.example','seed_list',1,'auto_filtered','spam','Filtered by check');
update public.opportunities set notes='Filtered result reviewed',
  reviewer_id='98000000-0000-0000-0000-000000000001'
  where id='98000000-0000-0000-0000-000000000005';
select is((select count(*)::integer from public.opportunity_reviews),4,
  'filtered-row metadata is also audited');

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select count(*)::integer from public.opportunity_reviews),4,
  'manager with filtered permission sees all review history');
reset role;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*)::integer from public.opportunity_reviews),3,
  'viewer cannot see history for filtered rows');
select is((select count(*)::integer from public.opportunity_reviews
  where opportunity_id='98000000-0000-0000-0000-000000000004'),3,
  'viewer can see history for visible rows');
reset role;

select * from finish();
rollback;
