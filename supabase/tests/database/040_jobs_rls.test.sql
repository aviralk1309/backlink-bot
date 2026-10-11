begin;
select plan(57);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres; triggers still fire, RLS is bypassed)
-- a1 admin, a2 manager (blocklist.manage, no jobs.create), a3 viewer,
-- a4 pending
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'pending@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a3';

insert into public.jobs (name, status) values
  ('Fixture draft', 'draft'),
  ('Fixture running', 'running');
insert into public.activity_profiles (key, name) values
  ('test_activity', 'Test activity');
insert into public.blocklist (domain, reason) values
  ('spam-site.com', 'fixture');

-- ---------------------------------------------------------------------
-- A. Privileges (13). Introspection, so no role switching is needed.
-- ---------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.jobs', 'select'),
  'anon cannot read jobs');
select ok(not has_table_privilege('anon', 'public.activity_profiles', 'select'),
  'anon cannot read activity_profiles');
select ok(not has_table_privilege('anon', 'public.blocklist', 'select'),
  'anon cannot read blocklist');
select ok(not has_table_privilege('anon', 'public.job_events', 'select'),
  'anon cannot read job_events');
select ok(not has_column_privilege('authenticated', 'public.jobs', 'status', 'update'),
  'signed-in users cannot update jobs.status');
select ok(not has_column_privilege('authenticated', 'public.jobs', 'config_version', 'update'),
  'signed-in users cannot update jobs.config_version');
select ok(not has_column_privilege('authenticated', 'public.jobs', 'status', 'insert'),
  'signed-in users cannot insert jobs.status');
select ok(not has_table_privilege('authenticated', 'public.job_events', 'insert'),
  'signed-in users cannot write job_events');
select ok(not has_table_privilege('authenticated', 'public.job_config_history', 'insert'),
  'signed-in users cannot write job_config_history');
select ok(not has_table_privilege('authenticated', 'public.activity_profiles', 'delete'),
  'signed-in users cannot delete activity profiles');
select ok(not has_column_privilege('authenticated', 'public.activity_profiles', 'version', 'update'),
  'signed-in users cannot set activity_profiles.version');
select ok(not has_column_privilege('authenticated', 'public.blocklist', 'domain', 'update'),
  'signed-in users cannot change a blocklist domain');
select ok(has_column_privilege('authenticated', 'public.jobs', 'name', 'update'),
  'jobs.name stays updatable (RLS decides who)');

set local role authenticated;

-- ---------------------------------------------------------------------
-- B. Pending user (2)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a4', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.jobs), 0,
  'pending user reads no jobs');
select is((select count(*)::int from public.activity_profiles), 0,
  'pending user reads no activity profiles');

-- ---------------------------------------------------------------------
-- C. Viewer (9)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.jobs), 2,
  'viewer reads jobs');
select throws_ok(
  $$insert into public.jobs (name) values ('Viewer job')$$,
  '42501', null,
  'viewer cannot create a job'
);
select is_empty(
  $$update public.jobs set name = 'Renamed' where name = 'Fixture draft' returning 1$$,
  'viewer cannot edit a job'
);
select is_empty(
  $$delete from public.jobs where name = 'Fixture draft' returning 1$$,
  'viewer cannot delete a job'
);
select is((select count(*)::int from public.activity_profiles
            where key = 'test_activity'), 1,
  'viewer reads activity profiles');
select ok(
  (select count(*) from public.activity_profiles
    where key in ('guest_post', 'resource_page')) = 2,
  'viewer reads the starter activity profiles'
);
select throws_ok(
  $$insert into public.activity_profiles (key, name) values ('viewer_act', 'x')$$,
  '42501', null,
  'viewer cannot create an activity profile'
);
select is_empty(
  $$update public.activity_profiles set name = 'x' where key = 'test_activity' returning 1$$,
  'viewer cannot edit an activity profile'
);
select is((select count(*)::int from public.blocklist), 0,
  'viewer cannot see the blocklist');
select throws_ok(
  $$insert into public.blocklist (domain) values ('viewer-try.com')$$,
  '42501', null,
  'viewer cannot add to the blocklist'
);

-- ---------------------------------------------------------------------
-- D. Manager (8)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select throws_ok(
  $$insert into public.jobs (name) values ('Manager job')$$,
  '42501', null,
  'manager cannot create a job'
);
select is((select count(*)::int from public.blocklist), 1,
  'manager sees the blocklist');
select lives_ok(
  $$insert into public.blocklist (domain, reason)
      values ('added-by-manager.com', 'test')$$,
  'manager can add to the blocklist'
);
select is((select count(*)::int from public.blocklist), 2,
  'the blocklist entry is there');
select lives_ok(
  $$delete from public.blocklist where domain = 'added-by-manager.com'$$,
  'manager can remove a blocklist entry'
);
select is((select count(*)::int from public.blocklist), 1,
  'the blocklist entry is gone');
select throws_ok(
  $$insert into public.blocklist (domain) values ('Not A Domain')$$,
  '23514', null,
  'a malformed blocklist domain is rejected'
);
select throws_ok(
  $$insert into public.activity_profiles (key, name) values ('mgr_act', 'x')$$,
  '42501', null,
  'manager cannot create an activity profile'
);

-- ---------------------------------------------------------------------
-- E. Admin (24)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select lives_ok(
  $$insert into public.jobs (name) values ('Admin job')$$,
  'admin can create a job'
);
select is(
  (select status::text from public.jobs where name = 'Admin job'),
  'draft',
  'a new job starts as draft'
);
select is(
  (select created_by from public.jobs where name = 'Admin job'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'created_by records the creator'
);
select throws_ok(
  $$insert into public.jobs (name, status) values ('Sneaky', 'running')$$,
  '42501', null,
  'admin cannot pick a status on insert'
);
select throws_ok(
  $$update public.jobs set status = 'running' where name = 'Admin job'$$,
  '42501', null,
  'admin cannot change status directly'
);
select throws_ok(
  $$update public.jobs set config_version = 9 where name = 'Admin job'$$,
  '42501', null,
  'admin cannot change config_version directly'
);
select lives_ok(
  $$update public.jobs set name = 'Admin job renamed' where name = 'Admin job'$$,
  'admin can edit a job'
);
select is(
  (select count(*)::int from public.jobs where name = 'Admin job renamed'),
  1,
  'the edit took effect'
);
select throws_ok(
  $$insert into public.jobs (name, country) values ('Bad country', 'usa')$$,
  '23514', null,
  'country must be an ISO 3166 alpha-2 code'
);
select throws_ok(
  $$insert into public.jobs (name, language) values ('Bad language', 'EN')$$,
  '23514', null,
  'language must be an ISO 639-1 code'
);
select throws_ok(
  $$insert into public.jobs (name, pages_per_query) values ('Bad pages', 0)$$,
  '23514', null,
  'pages per query must be at least 1'
);
select lives_ok(
  $$insert into public.activity_profiles (key, name) values ('forum', 'Forum')$$,
  'admin can create an activity profile'
);
select is(
  (select version from public.activity_profiles where key = 'forum'),
  1,
  'a new activity profile is version 1'
);
select lives_ok(
  $$update public.activity_profiles set per_domain_cap = 3 where key = 'forum'$$,
  'admin can edit an activity profile'
);
select is(
  (select version from public.activity_profiles where key = 'forum'),
  2,
  'a real change bumps the version'
);
select lives_ok(
  $$update public.activity_profiles set name = name where key = 'forum'$$,
  'admin can save an activity profile without changes'
);
select is(
  (select version from public.activity_profiles where key = 'forum'),
  2,
  'a no-op save keeps the version'
);
select throws_ok(
  $$insert into public.activity_profiles (key, name) values ('Bad Key', 'x')$$,
  '23514', null,
  'activity keys must be lowercase snake case'
);
select lives_ok(
  $$update public.activity_profiles set enabled = false where key = 'forum'$$,
  'admin can disable an activity profile'
);
select throws_ok(
  $$delete from public.activity_profiles where key = 'forum'$$,
  '42501', null,
  'activity profiles cannot be deleted'
);
select is_empty(
  $$delete from public.jobs where name = 'Fixture running' returning 1$$,
  'a running job cannot be deleted'
);
select lives_ok(
  $$delete from public.jobs where name = 'Admin job renamed'$$,
  'admin can delete a draft job'
);
select is(
  (select count(*)::int from public.jobs where name like 'Admin job%'),
  0,
  'the deleted job is gone'
);
select throws_ok(
  $$insert into public.job_events (job_id, type)
      select id, 'x' from public.jobs limit 1$$,
  '42501', null,
  'admin cannot write job_events directly'
);

reset role;
select * from finish();
rollback;