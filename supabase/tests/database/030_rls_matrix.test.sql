begin;
select plan(50);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres; triggers still fire, RLS is bypassed)
-- a1 admin, a2 manager, a3 viewer, a4 pending, a5 deactivated
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'pending@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', 'gone@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a3';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a5';
update public.profiles set status = 'deactivated'
  where id = '00000000-0000-0000-0000-0000000000a5';

-- ---------------------------------------------------------------------
-- A. Privileges (13). Introspection, so no role switching is needed.
-- ---------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.roles', 'select'),
  'anon cannot read roles');
select ok(not has_table_privilege('anon', 'public.permissions', 'select'),
  'anon cannot read permissions');
select ok(not has_table_privilege('anon', 'public.role_permissions', 'select'),
  'anon cannot read role_permissions');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon cannot read profiles');
select ok(not has_function_privilege('anon', 'public.has_permission(text)', 'execute'),
  'anon cannot call has_permission');
select ok(not has_function_privilege('anon', 'public.current_role_id()', 'execute'),
  'anon cannot call current_role_id');
select ok(not has_function_privilege('anon', 'public.role_user_counts()', 'execute'),
  'anon cannot call role_user_counts');
select ok(
  not has_function_privilege('anon', 'public.save_role(uuid,text,text,text[])', 'execute'),
  'anon cannot call save_role');
select ok(
  not (has_table_privilege('authenticated', 'public.permissions', 'insert')
    or has_table_privilege('authenticated', 'public.permissions', 'update')
    or has_table_privilege('authenticated', 'public.permissions', 'delete')),
  'signed-in users cannot write the permission catalog');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'insert'),
  'signed-in users cannot insert profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'signed-in users cannot delete profiles');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'email', 'update'),
  'signed-in users cannot update profiles.email');
select ok(has_column_privilege('authenticated', 'public.profiles', 'role_id', 'update'),
  'role_id stays updatable (RLS decides who)');

set local role authenticated;

-- ---------------------------------------------------------------------
-- B. Deactivated user (6)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a5', 'role', 'authenticated')::text, true);
select ok(not public.has_permission('jobs.view'),
  'deactivated user has no permissions');
select ok(public.current_role_id() is null,
  'deactivated user has no current role');
select is((select count(*)::int from public.roles), 0,
  'deactivated user reads no roles');
select is((select count(*)::int from public.permissions), 0,
  'deactivated user reads no permissions');
select is((select count(*)::int from public.role_permissions), 0,
  'deactivated user reads no role_permissions');
select is((select count(*)::int from public.profiles), 1,
  'deactivated user reads only their own profile');

-- ---------------------------------------------------------------------
-- C. Pending user (3)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a4', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.permissions), 0,
  'pending user reads no permissions');
select is((select count(*)::int from public.role_permissions), 0,
  'pending user reads no role_permissions');
select ok(public.current_role_id() is null,
  'pending user has no current role');

-- ---------------------------------------------------------------------
-- D. Viewer (7)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.permissions), 20,
  'viewer reads the whole catalog');
select is((select count(*)::int from public.role_permissions), 33,
  'viewer reads every role grant (20 + 10 + 3)');
select throws_ok(
  $$insert into public.role_permissions (role_id, permission_key)
      values ('a0000000-0000-0000-0000-000000000003', 'jobs.create')$$,
  '42501', null,
  'viewer cannot grant a permission'
);
select is_empty(
  $$delete from public.role_permissions
      where role_id = 'a0000000-0000-0000-0000-000000000003'
      returning 1$$,
  'viewer cannot remove a grant'
);
select is_empty(
  $$update public.role_permissions set permission_key = 'jobs.create'
      where role_id = 'a0000000-0000-0000-0000-000000000003'
        and permission_key = 'jobs.view'
      returning 1$$,
  'viewer cannot change a grant'
);
select is_empty(
  $$update public.roles set name = 'Renamed'
      where id = 'a0000000-0000-0000-0000-000000000003'
      returning 1$$,
  'viewer cannot rename a role'
);
select is_empty(
  $$delete from public.roles
      where id = 'a0000000-0000-0000-0000-000000000003'
      returning 1$$,
  'viewer cannot delete a role'
);

-- ---------------------------------------------------------------------
-- E. Manager (4)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select throws_ok(
  $$insert into public.role_permissions (role_id, permission_key)
      values ('a0000000-0000-0000-0000-000000000003', 'jobs.create')$$,
  '42501', null,
  'manager cannot grant a permission'
);
select is_empty(
  $$update public.profiles
      set role_id = 'a0000000-0000-0000-0000-000000000001'
      where id = '00000000-0000-0000-0000-0000000000a2'
      returning 1$$,
  'manager cannot escalate their own role'
);
select is_empty(
  $$update public.profiles set status = 'deactivated'
      where id = '00000000-0000-0000-0000-0000000000a2'
      returning 1$$,
  'manager cannot change their own status'
);
select is((select count(*)::int from public.roles), 3,
  'manager reads every role');

-- ---------------------------------------------------------------------
-- F. Admin (13)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select throws_ok(
  $$insert into public.permissions (key, "group", description)
      values ('x.y', 'X', 'x')$$,
  '42501', null,
  'admin cannot add to the permission catalog'
);
select throws_ok(
  $$update public.permissions set description = 'x' where key = 'jobs.view'$$,
  '42501', null,
  'admin cannot edit the permission catalog'
);
select throws_ok(
  $$delete from public.permissions where key = 'jobs.view'$$,
  '42501', null,
  'admin cannot delete from the permission catalog'
);
select throws_ok(
  $$insert into public.profiles (id, email)
      values ('00000000-0000-0000-0000-0000000000b1', 'x@test.local')$$,
  '42501', null,
  'admin cannot insert profiles directly'
);
select throws_ok(
  $$delete from public.profiles
      where id = '00000000-0000-0000-0000-0000000000a3'$$,
  '42501', null,
  'admin cannot delete profiles directly'
);
select throws_ok(
  $$update public.profiles set email = 'other@test.local'
      where id = '00000000-0000-0000-0000-0000000000a3'$$,
  '42501', null,
  'admin cannot change a profile email'
);
select throws_ok(
  $$insert into public.roles (name, is_system) values ('SysTry', true)$$,
  '42501', null,
  'admin cannot create a system role'
);
select throws_ok(
  $$insert into public.roles (name, is_protected) values ('ProtTry', true)$$,
  '42501', null,
  'admin cannot create a protected role'
);
select lives_ok(
  $$update public.roles set description = 'Edited'
      where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'admin can edit a starter role description'
);
select is((select count(*)::int from public.profiles), 5,
  'admin sees every profile');
select is(public.current_role_id(), 'a0000000-0000-0000-0000-000000000001'::uuid,
  'admin current role is Admin');

-- ---------------------------------------------------------------------
-- G. Lockout guards as a signed-in Admin (4), then a role change (2 of F)
-- ---------------------------------------------------------------------
select throws_ok(
  $$delete from public.roles where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'P0001', 'lockout_protected_role',
  'admin session cannot delete the Admin role'
);
select throws_ok(
  $$delete from public.role_permissions
      where role_id = 'a0000000-0000-0000-0000-000000000001'
        and permission_key = 'roles.manage'$$,
  'P0001', 'lockout_admin_permission',
  'admin session cannot strip roles.manage from Admin'
);
select throws_ok(
  $$update public.profiles set status = 'deactivated'
      where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'lockout_last_admin',
  'admin session cannot deactivate the last Admin'
);
select throws_ok(
  $$delete from public.roles where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'P0001', 'lockout_role_in_use',
  'admin session cannot delete a role that has users'
);

-- Last in the file: it changes who holds which role.
select lives_ok(
  $$update public.profiles
      set role_id = 'a0000000-0000-0000-0000-000000000003'
      where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'admin can change another user''s role'
);
select is(
  (select role_id from public.profiles
     where id = '00000000-0000-0000-0000-0000000000a2'),
  'a0000000-0000-0000-0000-000000000003'::uuid,
  'the role change took effect'
);

reset role;
select * from finish();
rollback;