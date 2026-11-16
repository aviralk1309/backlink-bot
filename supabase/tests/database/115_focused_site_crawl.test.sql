begin;
select plan(10);

insert into public.jobs(id,name,status,started_at) values
  ('e1150000-0000-0000-0000-000000000001','Focused crawl test','running',clock_timestamp());
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,check_status) values
  ('e1150000-0000-0000-0000-000000000011',
   'e1150000-0000-0000-0000-000000000001','https://crawlsite.com/yoga',
   'https://crawlsite.com/yoga','crawlsite.com','crawlsite.com','google',1,'done');
select is(public.record_site_crawl_candidates(
  'e1150000-0000-0000-0000-000000000001','e1150000-0000-0000-0000-000000000011',
  '[{"original_url":"https://crawlsite.com/resources","normalized_url":"https://crawlsite.com/resources","host":"crawlsite.com","domain":"crawlsite.com"},
    {"original_url":"https://crawlsite.com/partners","normalized_url":"https://crawlsite.com/partners","host":"crawlsite.com","domain":"crawlsite.com"}]'),
  2,'two same-domain child pages are admitted');
select is((select count(*)::integer from public.opportunities where
  job_id='e1150000-0000-0000-0000-000000000001' and first_source_type='site_crawl'),
  2,'crawl pages are distinct opportunities');
select is((select count(*)::integer from public.opportunity_sources s
  join public.opportunities o on o.id=s.opportunity_id
  where o.job_id='e1150000-0000-0000-0000-000000000001'
    and s.source_type='site_crawl' and s.source_ref='e1150000-0000-0000-0000-000000000011'),
  2,'each child retains parent provenance');
select is(public.record_site_crawl_candidates(
  'e1150000-0000-0000-0000-000000000001','e1150000-0000-0000-0000-000000000011',
  '[{"original_url":"https://crawlsite.com/more-resources","normalized_url":"https://crawlsite.com/more-resources","host":"crawlsite.com","domain":"crawlsite.com"}]'),
  0,'the domain ceiling prevents a third child');
select is(public.record_site_crawl_candidates(
  'e1150000-0000-0000-0000-000000000001',
  (select id from public.opportunities where normalized_url='https://crawlsite.com/resources'),
  '[]'),0,'a crawl child cannot recurse');
select throws_ok($$select public.record_site_crawl_candidates(
  'e1150000-0000-0000-0000-000000000001','e1150000-0000-0000-0000-000000000011',
  '[{},{},{}]')$$,'22023','invalid_crawl_candidates','a call cannot exceed two candidates');
update public.jobs set started_at=clock_timestamp()-interval '6 minutes'
where id='e1150000-0000-0000-0000-000000000001';
select is(public.record_site_crawl_candidates(
  'e1150000-0000-0000-0000-000000000001','e1150000-0000-0000-0000-000000000011',
  '[]'),0,'the five-minute job crawl deadline stops discovery');
select is((select count(*)::integer from public.opportunities
  where job_id='e1150000-0000-0000-0000-000000000001'),3,
  'existing landing page and two children remain intact');

insert into auth.users(id,email) values
  ('e1150000-0000-0000-0000-000000000099','crawl-admin@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000001'
  where id='e1150000-0000-0000-0000-000000000099';
select set_config('request.jwt.claim.sub','e1150000-0000-0000-0000-000000000099',true);
set local role authenticated;
select is((select count(*)::integer from public.list_job_results(
  p_job_id=>'e1150000-0000-0000-0000-000000000001',p_queue=>null,
  p_source=>'site_crawl')),2,'result list filters crawl provenance');
select is((select count(*)::integer from public.export_result_batch(
  p_job_id=>'e1150000-0000-0000-0000-000000000001',p_queue=>null,
  p_source=>'site_crawl')),2,'export filters crawl provenance');
reset role;

select * from finish();
rollback;
