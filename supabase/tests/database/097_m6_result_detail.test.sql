begin;
select plan(16);

insert into auth.users(id,email) values
  ('97000000-0000-0000-0000-000000000001','detail-manager@tests.local'),
  ('97000000-0000-0000-0000-000000000002','detail-viewer@tests.local');
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000002'
  where id='97000000-0000-0000-0000-000000000001';
update public.profiles set status='active',role_id='a0000000-0000-0000-0000-000000000003'
  where id='97000000-0000-0000-0000-000000000002';
insert into public.jobs(id,name) values ('97000000-0000-0000-0000-000000000003','Result detail test');
insert into public.opportunities(id,job_id,original_url,normalized_url,host,domain,
  first_source_type,config_version,queue_group,filter_reason) values
  ('97000000-0000-0000-0000-000000000004','97000000-0000-0000-0000-000000000003',
   'https://detail.example/a','https://detail.example/a','detail.example','detail.example',
   'seed_list',1,'ready',null),
  ('97000000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000003',
   'https://detail.example/b','https://detail.example/b','detail.example','detail.example',
   'seed_list',1,'auto_filtered','spam');

select ok(has_function_privilege('authenticated','public.save_opportunity_metadata(uuid,bigint,text,jsonb)','execute'),
  'authenticated clients may call the bounded RPC');
select ok(not has_function_privilege('anon','public.save_opportunity_metadata(uuid,bigint,text,jsonb)','execute'),
  'anonymous callers cannot call the RPC');

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,'no','{}')$$,
  '42501','permission_denied','viewer cannot edit metadata');
reset role;

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,'bad','{"nested":{}}')$$,
  '22023','invalid_review_metadata','nested metric values are rejected');
select throws_ok($$select public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,'bad','{"dr":-2}')$$,
  '22023','invalid_review_metadata','negative metrics are rejected');
select throws_ok($$select public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,'bad','{"dr":101}')$$,
  '22023','invalid_review_metadata','domain rating is bounded to 100');
select throws_ok($$select public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,repeat('x',4001),'{}')$$,
  '22023','invalid_review_metadata','oversized notes are rejected');
select is(public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,
  '<script>alert(1)</script>','{"dr":42,"contact_email":"a@example.com"}'),
  'saved','manager can save notes and external metrics');
select is(public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',0,'overwrite','{}'),
  'stale','stale version cannot overwrite an edit');
select is(public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',1,
  '<script>alert(1)</script>','{}'),'saved','a no-op is accepted');
select is(public.save_opportunity_metadata('97000000-0000-0000-0000-000000000004',1,
  'updated','{"dr":null,"traffic":100}'),'saved','null removes one metric');
reset role;
select is((select row_version from public.opportunities where id='97000000-0000-0000-0000-000000000004'),
  2::bigint,'only real edits advance the version');
select is((select external_metrics from public.opportunities where id='97000000-0000-0000-0000-000000000004'),
  '{"contact_email":"a@example.com","traffic":100}'::jsonb,'other metrics survive patch edits');
select is((select count(*)::integer from public.opportunity_reviews where opportunity_id='97000000-0000-0000-0000-000000000004'),
  2,'each real edit is audited');
select is((select reviewer_id from public.opportunity_reviews where opportunity_id='97000000-0000-0000-0000-000000000004' and row_version=2),
  '97000000-0000-0000-0000-000000000001'::uuid,'audit records the reviewer');
delete from public.role_permissions where role_id='a0000000-0000-0000-0000-000000000002' and permission_key='results.view_filtered';
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(public.save_opportunity_metadata('97000000-0000-0000-0000-000000000005',0,'hidden','{}'),
  'missing','review permission alone cannot edit a filtered result');
reset role;

select * from finish();
rollback;
