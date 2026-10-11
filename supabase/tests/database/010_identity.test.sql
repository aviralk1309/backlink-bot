begin;
select plan(32);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres; triggers still fire, RLS is bypassed)
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

-- ---------------------------------------------------------------------
-- Schema and seed (5 + 3 = 8)
-- ---------------------------------------------------------------------
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'roles', 'roles exists');
select has_table('public', 'permissions', 'permissions exists');
select has_table('public', 'role_permissions', 'role_permissions exists');

select is(
  (select count(*)::int from public.permissions),
  20,
  'catalog has 20 permissions'
);

select is(
  (select count(*)::int from public.role_permissions
   where role_id = 'a0000000-0000-0000-0000-000000000001'),
  20,
  'Admin holds every permission'
);

select is(
  (select array_agg(permission_key order by permission_key collate "C")
   from public.role_permissions
   where role_id = 'a0000000-0000-0000-0000-000000000002'),
  array[
    'blocklist.manage', 'csv.upload', 'jobs.view', 'mapping_templates.manage',
    'reports.view', 'results.export', 'results.release_batch',
    'results.review', 'results.view', 'results.view_filtered'
  ]::text[],
  'Manager has the expected permissions'
);

select is(
  (select array_agg(permission_key order by permission_key collate "C")
   from public.role_permissions
   where role_id = 'a0000000-0000-0000-0000-000000000003'),
  array['jobs.view', 'reports.view', 'results.view']::text[],
  'Viewer has the expected permissions'
);

-- ---------------------------------------------------------------------
-- has_permission (4) -> 12
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select ok(public.has_permission('roles.manage'), 'admin has roles.manage');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select ok(public.has_permission('jobs.view'), 'viewer has jobs.view');
select ok(not public.has_permission('jobs.create'), 'viewer lacks jobs.create');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a4', 'role', 'authenticated')::text, true);
select ok(not public.has_permission('jobs.view'), 'pending user has no permissions');
reset role;

-- ---------------------------------------------------------------------
-- RLS matrix (10) -> 22
-- ---------------------------------------------------------------------
set local role authenticated;

-- viewer
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.roles), 3, 'viewer reads roles');
select throws_ok(
  $$insert into public.roles (name) values ('sneaky')$$,
  '42501',
  null,
  'viewer cannot create roles'
);
select is((select count(*)::int from public.profiles), 1, 'viewer sees only own profile');
select is_empty(
  $$update public.profiles
      set role_id = 'a0000000-0000-0000-0000-000000000001'
      where id = '00000000-0000-0000-0000-0000000000a3'
      returning 1$$,
  'viewer cannot escalate own role'
);

-- pending
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a4', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.roles), 0, 'pending user reads no roles');
select is((select count(*)::int from public.profiles), 1, 'pending user reads own profile');

-- manager
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select throws_ok(
  $$insert into public.roles (name) values ('sneaky2')$$,
  '42501',
  null,
  'manager cannot create roles'
);
select is_empty(
  $$update public.profiles set full_name = 'x'
      where id = '00000000-0000-0000-0000-0000000000a3'
      returning 1$$,
  'manager cannot edit other profiles'
);

-- admin
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.profiles), 4, 'admin sees every profile');
select lives_ok(
  $$insert into public.roles (name) values ('intern')$$,
  'admin can create a role'
);
reset role;

-- ---------------------------------------------------------------------
-- Lockout guards (10) -> 32
-- ---------------------------------------------------------------------
select throws_ok(
  $$delete from public.roles where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'P0001', 'lockout_protected_role',
  'protected Admin role cannot be deleted'
);

select throws_ok(
  $$update public.roles set is_protected = false
      where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'P0001', 'lockout_protected_role',
  'Admin cannot lose its protected flag'
);

select throws_ok(
  $$delete from public.role_permissions
      where role_id = 'a0000000-0000-0000-0000-000000000001'
        and permission_key = 'roles.manage'$$,
  'P0001', 'lockout_admin_permission',
  'Admin cannot lose roles.manage'
);

select throws_ok(
  $$delete from public.role_permissions
      where role_id = 'a0000000-0000-0000-0000-000000000001'
        and permission_key = 'users.manage'$$,
  'P0001', 'lockout_admin_permission',
  'Admin cannot lose users.manage'
);

select throws_ok(
  $$delete from public.roles where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'P0001', 'lockout_role_in_use',
  'role with users cannot be deleted'
);

select throws_ok(
  $$update public.profiles set status = 'deactivated'
      where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'lockout_last_admin',
  'last admin cannot be deactivated'
);

select throws_ok(
  $$update public.profiles
      set role_id = 'a0000000-0000-0000-0000-000000000002'
      where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'lockout_last_admin',
  'last admin cannot be demoted'
);

select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'lockout_last_admin',
  'last admin cannot be deleted'
);

select throws_ok(
  $$update public.profiles set role_id = null
      where id = '00000000-0000-0000-0000-0000000000a3'$$,
  '23514', null,
  'active user must keep a role'
);

-- With a second admin, the first can be deactivated
update public.profiles
  set role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a2';
select lives_ok(
  $$update public.profiles set status = 'deactivated'
      where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'an admin can be deactivated when another admin exists'
);

select * from finish();
rollback;