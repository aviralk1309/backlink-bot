begin;
select plan(5);

insert into public.jobs(id,name,status) values
  ('e1150000-0000-0000-0000-000000000001','CSV purge evidence','running');
insert into public.csv_uploads(id,job_id,kind,filename,storage_path,size_bytes,status,mapping,confirmed_at)
values ('e1150000-0000-0000-0000-000000000011',
  'e1150000-0000-0000-0000-000000000001','client','client.csv',
  'test/client.csv',100,'confirmed','{"url_index":0}',now());
insert into public.csv_rows(upload_id,row_no,raw_url,normalized_url,host,domain,is_valid,error_code)
values
  ('e1150000-0000-0000-0000-000000000011',1,'https://linked.example/a',
    'https://linked.example/a','linked.example','linked.example',true,null),
  ('e1150000-0000-0000-0000-000000000011',2,'bad',null,null,null,false,'bad_url');

select ok(not has_table_privilege('authenticated','public.job_client_domains','select'),
  'browser users cannot read retained client domains');
insert into public.job_client_domains(job_id,domain)
select distinct u.job_id,r.domain from public.csv_uploads u
join public.csv_rows r on r.upload_id=u.id
where u.job_id='e1150000-0000-0000-0000-000000000001'
  and u.kind='client' and u.status='confirmed' and r.is_valid and r.domain is not null
on conflict do nothing;
delete from public.csv_rows r using public.csv_uploads u
where r.upload_id=u.id and u.job_id='e1150000-0000-0000-0000-000000000001'
  and u.status='confirmed';
select is((select count(*)::integer from public.csv_rows r join public.csv_uploads u on u.id=r.upload_id
  where u.job_id='e1150000-0000-0000-0000-000000000001'),0,
  'confirmed staging rows are gone');
select is((select array_agg(domain) from public.job_client_domains
  where job_id='e1150000-0000-0000-0000-000000000001'),
  array['linked.example'],'only valid client domains remain');

select opp_id from public.record_discovery('e1150000-0000-0000-0000-000000000001',
  'https://linked.example/new','https://linked.example/new',
  'linked.example','linked.example','google','query-a');
select ok((select flags->>'already_links_to_client'='true' and client_link_status='known_partial'
  from public.opportunities where normalized_url='https://linked.example/new'),
  'later Google discovery still uses client-domain evidence');
select opp_id from public.record_discovery('e1150000-0000-0000-0000-000000000001',
  'https://other.example/new','https://other.example/new',
  'other.example','other.example','google','query-b');
select ok((select not flags ? 'already_links_to_client'
  from public.opportunities where normalized_url='https://other.example/new'),
  'unrelated discovery is not flagged');

select * from finish();
rollback;
