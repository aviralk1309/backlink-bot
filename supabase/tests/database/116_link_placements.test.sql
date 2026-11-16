begin;
select plan(20);

insert into auth.users(id,email) values
  ('e1160000-0000-0000-0000-000000000099','links-admin@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='e1160000-0000-0000-0000-000000000099';
insert into public.jobs(id,name,client_domain) values
  ('e1160000-0000-0000-0000-000000000001','Link tracking test','client.com');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,check_status,score,tier,queue_group) values
  ('e1160000-0000-0000-0000-000000000011','e1160000-0000-0000-0000-000000000001',
   'https://publisher.com/page','https://publisher.com/page','publisher.com','publisher.com',
   'google',1,'done',75,'medium','ready');
update public.opportunities set score_breakdown=jsonb_build_object(
  'algorithm_version',1,'scoring_config_version',1,'components',
  (select jsonb_agg(jsonb_build_object('component',key,'raw',0)) from unnest(array[
    'relevance','language_region','activity_fit','overlap','multi_query','spam_penalty']) key))
  where id='e1160000-0000-0000-0000-000000000011';
update public.opportunities set reviewer_id='e1160000-0000-0000-0000-000000000099',
  review_status='in_review' where id='e1160000-0000-0000-0000-000000000011';
update public.opportunities set review_status='approved'
  where id='e1160000-0000-0000-0000-000000000011';
insert into public.job_queries(id,job_id,activity_key,template_id,template_version,query_text,
  status,credits_used) values
  ('e1160000-0000-0000-0000-000000000021','e1160000-0000-0000-0000-000000000001',
   'guest_post','t1',1,'yoga guest post','done',2);
insert into public.opportunity_sources(opportunity_id,source_type,source_ref) values
  ('e1160000-0000-0000-0000-000000000011','google',
   'e1160000-0000-0000-0000-000000000021');

select set_config('request.jwt.claim.sub','e1160000-0000-0000-0000-000000000099',true);
set local role authenticated;
select is(public.save_link_placement('e1160000-0000-0000-0000-000000000011',
  'contacted','','',null,0),'saved','outreach status can be saved before a link exists');
select is(public.save_link_placement('e1160000-0000-0000-0000-000000000011',
  'live','https://client.com/retreat','https://publisher.com/page',current_date,99),
  'stale','manual updates are version fenced');
select throws_ok($$select public.save_link_placement(
  'e1160000-0000-0000-0000-000000000011','live',
  'https://other.com','https://publisher.com/page',current_date,1)$$,
  '22023','target_not_client_domain','target must belong to the client');
select is(public.save_link_placement('e1160000-0000-0000-0000-000000000011',
  'live','https://client.com/retreat','https://publisher.com/page',current_date,0),
  'saved','live placement enters verification queue');
select is((select verification_status from public.link_placements),
  'pending','submitted link is pending, never assumed verified');
select is((select verified_count from public.report_link_delivery(
  'e1160000-0000-0000-0000-000000000001') where dimension='client'),
  0::bigint,'approved prospect is not a delivered backlink');
reset role;

select is((select attempts from public.worker_claim_link_placement('test-worker',60)),
  1,'worker can claim the pending check');
select ok(not public.worker_finish_link_placement((select id from public.link_placements),
  'wrong-worker',1,'verified',array['follow'],null,null),
  'another worker cannot finish the claim');
select ok(public.worker_finish_link_placement((select id from public.link_placements),
  'test-worker',1,'verified',array['nofollow'],'https://publisher.com/page',null),
  'worker records verified link and rel');
set local role authenticated;
select ok((select verified_count=1 and credits_used=2 and credits_per_verified=2
  from public.report_link_delivery('e1160000-0000-0000-0000-000000000001')
  where dimension='template' and dimension_key='guest_post/t1'),
  'template cost and verified link are reported together');
reset role;
update public.link_placements set next_check_at=clock_timestamp()-interval '1 second';
select is((select attempts from public.worker_claim_link_placement('test-worker',60)),
  1,'a prior verified link can be rechecked');
select ok(public.worker_finish_link_placement((select id from public.link_placements),
  'test-worker',1,'unverified',array[]::text[],'https://publisher.com/page','link_missing'),
  'removed link becomes unverified');
set local role authenticated;
select is((select verified_count from public.report_link_delivery(
  'e1160000-0000-0000-0000-000000000001') where dimension='client'),
  0::bigint,'removed link no longer counts as delivered');
reset role;
update public.link_placements set next_check_at=clock_timestamp()-interval '1 second';
select id from public.worker_claim_link_placement('test-worker',60);
select ok(public.worker_finish_link_placement((select id from public.link_placements),
  'test-worker',1,'unknown',array[]::text[],'https://publisher.com/page','robots_disallow'),
  'blocked recheck is unknown, not missing');
set local role authenticated;
select is((select count(*)::integer from public.link_placement_events),
  5,'manual and verification transitions are audited');
select is(public.save_link_placement('e1160000-0000-0000-0000-000000000011',
  'closed','https://client.com/retreat','https://publisher.com/page',current_date,4),
  'saved','closing outreach removes a link from current delivery counts');
select is(public.save_link_placement('e1160000-0000-0000-0000-000000000011',
  'live','https://client.com/retreat','https://publisher.com/updated',current_date,5),
  'saved','reviewer can correct the source page');
select ok((select first_seen_at is null and last_checked_at is null
  from public.link_placements),
  'corrected source does not inherit observation timestamps from the old page');
reset role;
select ok(not has_function_privilege('anon',
  'public.save_link_placement(uuid,text,text,text,date,bigint)','execute')
  and not has_function_privilege('worker',
  'public.save_link_placement(uuid,text,text,text,date,bigint)','execute'),
  'only signed-in reviewers can submit outreach changes');
select ok(not has_function_privilege('authenticated',
  'public.worker_finish_link_placement(uuid,text,integer,text,text[],text,text)','execute')
  and has_function_privilege('worker',
  'public.worker_finish_link_placement(uuid,text,integer,text,text[],text,text)','execute'),
  'only the worker can publish verification outcomes');

select * from finish();
rollback;
