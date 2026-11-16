begin;
select plan(12);

insert into public.jobs(id,name,status) values
  ('99300000-0000-0000-0000-000000000001','Client CSV search','running'),
  ('99300000-0000-0000-0000-000000000002','Unconfirmed CSV search','running');
insert into public.csv_uploads(id,job_id,kind,filename,storage_path,size_bytes,status,mapping,confirmed_at)
values
  ('99300000-0000-0000-0000-000000000011','99300000-0000-0000-0000-000000000001',
    'client','client.csv','test/client.csv',100,'confirmed','{"url_index":0}',now()),
  ('99300000-0000-0000-0000-000000000012','99300000-0000-0000-0000-000000000002',
    'client','draft.csv','test/draft.csv',100,'ready','{"url_index":0}',null);
insert into public.csv_rows(upload_id,row_no,raw_url,normalized_url,host,domain,is_valid,error_code)
values
  ('99300000-0000-0000-0000-000000000011',1,'https://linked.example/a',
    'https://linked.example/a','linked.example','linked.example',true,null),
  ('99300000-0000-0000-0000-000000000011',2,'broken',
    null,null,'invalid.example',false,'bad_url'),
  ('99300000-0000-0000-0000-000000000012',1,'https://draft.example/a',
    'https://draft.example/a','draft.example','draft.example',true,null);

select ok(not has_function_privilege('authenticated','public.flag_google_client_links()','execute'),
  'browser users cannot call the flag trigger directly');

select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000001',
  'https://linked.example/one','https://linked.example/one',
  'linked.example','linked.example','google','query-a');
select ok((select flags->>'already_links_to_client'='true'
  from public.opportunities where normalized_url='https://linked.example/one'),
  'Google domain found in confirmed valid client CSV is flagged');
select is((select client_link_status from public.opportunities
  where normalized_url='https://linked.example/one'),'known_partial',
  'confirmed client file makes link status known partial');
select ok((select check_status='pending' and queue_group is null
  from public.opportunities where normalized_url='https://linked.example/one'),
  'already-links result remains eligible for checks and review');

select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000001',
  'https://other.example/one','https://other.example/one',
  'other.example','other.example','google','query-b');
select ok((select not flags ? 'already_links_to_client'
  from public.opportunities where normalized_url='https://other.example/one'),
  'nonmatching Google domain is not flagged');
select is((select client_link_status from public.opportunities
  where normalized_url='https://other.example/one'),'known_partial',
  'nonmatching result still knows a client file exists');

select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000001',
  'https://invalid.example/one','https://invalid.example/one',
  'invalid.example','invalid.example','google','query-c');
select ok((select not flags ? 'already_links_to_client'
  from public.opportunities where normalized_url='https://invalid.example/one'),
  'invalid client CSV row cannot set the flag');

select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000001',
  'https://linked.example/two','https://linked.example/two',
  'linked.example','linked.example','seed_list','seed');
select ok((select not flags ? 'already_links_to_client'
  from public.opportunities where normalized_url='https://linked.example/two'),
  'seed-only result is not given a Google-specific flag');
select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000001',
  'https://linked.example/two','https://linked.example/two',
  'linked.example','linked.example','google','query-d');
select ok((select flags->>'already_links_to_client'='true' and found_by_count=2
  from public.opportunities where normalized_url='https://linked.example/two'),
  'later Google discovery flags a result with an existing source');

select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000002',
  'https://draft.example/one','https://draft.example/one',
  'draft.example','draft.example','google','query-e');
select ok((select not flags ? 'already_links_to_client' and client_link_status='unknown'
  from public.opportunities where normalized_url='https://draft.example/one'),
  'unconfirmed client file is ignored');
select opp_id from public.record_discovery('99300000-0000-0000-0000-000000000002',
  'https://linked.example/other-job','https://linked.example/other-job',
  'linked.example','linked.example','google','query-f');
select ok((select not flags ? 'already_links_to_client'
  from public.opportunities where normalized_url='https://linked.example/other-job'),
  'matching domain in another job does not leak the flag');
select is((select count(*)::integer from public.opportunity_sources s
  join public.opportunities o on o.id=s.opportunity_id
  where o.normalized_url='https://linked.example/two' and s.source_type='google'),1,
  'Google provenance remains a distinct source');

select * from finish();
rollback;
