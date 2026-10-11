begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';

set local role authenticated;

-- manager (no roles.manage)
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select is_empty(
  $$select * from public.role_user_counts()$$,
  'manager gets no user counts'
);
select throws_ok(
  $$select public.save_role(null, 'Sneaky', null, array['jobs.view'])$$,
  '42501', 'forbidden',
  'manager cannot save a role'
);

-- admin
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

select is(
  (select user_count from public.role_user_counts()
    where role_id = 'a0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'admin sees Admin role user count'
);

select lives_ok(
  $$select public.save_role(null, '  Auditor ', 'Reads only', array['jobs.view', 'reports.view', 'jobs.view'])$$,
  'admin creates a role with permissions'
);
select is(
  (select count(*)::int from public.role_permissions
    where role_id = (select id from public.roles where name = 'Auditor')),
  2,
  'duplicate keys collapse, name is trimmed'
);

select lives_ok(
  $$select public.save_role(
      (select id from public.roles where name = 'Auditor'),
      'Auditor', null, array['jobs.view'])$$,
  'admin updates the permission set'
);
select is(
  (select count(*)::int from public.role_permissions
    where role_id = (select id from public.roles where name = 'Auditor')),
  1,
  'removed permission is gone'
);

select throws_ok(
  $$select public.save_role(null, 'AUDITOR', null, '{}')$$,
  '23505', null,
  'role names are unique ignoring case'
);
select throws_ok(
  $$select public.save_role(null, 'Bad', null, array['nope.nope'])$$,
  'P0001', 'invalid_permission',
  'unknown permission key is rejected'
);
select throws_ok(
  $$select public.save_role('a0000000-0000-0000-0000-00000000ffff', 'Ghost', null, '{}')$$,
  'P0001', 'role_not_found',
  'unknown role id is rejected'
);

select throws_ok(
  $$select public.save_role(
      'a0000000-0000-0000-0000-000000000001', 'Admin', null,
      array(select key from public.permissions where key <> 'roles.manage'))$$,
  'P0001', 'lockout_admin_permission',
  'Admin cannot lose roles.manage through save_role'
);
select lives_ok(
  $$select public.save_role(
      'a0000000-0000-0000-0000-000000000001', 'Admin', null,
      array(select key from public.permissions))$$,
  'Admin can be saved with every permission'
);

select lives_ok(
  $$select public.save_role(
      (select id from public.roles where name = 'Auditor'),
      'Auditor', null, '{}')$$,
  'a role can be saved with no permissions'
);
select is(
  (select count(*)::int from public.role_permissions
    where role_id = (select id from public.roles where name = 'Auditor')),
  0,
  'empty set clears permissions'
);

select * from finish();
rollback;