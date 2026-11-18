-- S-01: direct authenticated profile writes must obey the D3 role ceiling.
begin;
select plan(9);

insert into public.roles (id, name)
values ('b1000000-0000-4000-8000-000000000001', 'S01 Users Manager');
insert into public.role_permissions (role_id, permission_key)
values ('b1000000-0000-4000-8000-000000000001', 'users.manage');

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-000000000002', 's01-actor@test.local'),
  ('b1000000-0000-4000-8000-000000000003', 's01-target@test.local'),
  ('b1000000-0000-4000-8000-000000000004', 's01-admin@test.local');
update public.profiles
set status = 'active', role_id = 'b1000000-0000-4000-8000-000000000001'
where id = 'b1000000-0000-4000-8000-000000000002';
update public.profiles
set status = 'active', role_id = 'a0000000-0000-0000-0000-000000000003'
where id = 'b1000000-0000-4000-8000-000000000003';
update public.profiles
set status = 'active', role_id = 'a0000000-0000-0000-0000-000000000001'
where id = 'b1000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true);
select ok(not public.can_assign_role('a0000000-0000-0000-0000-000000000001'),
  'S-01: users.manage alone cannot assign Admin');
select throws_ok(
  $$update public.profiles
    set role_id = 'a0000000-0000-0000-0000-000000000001'
    where id = 'b1000000-0000-4000-8000-000000000003'$$,
  '42501', 'role_assignment_forbidden',
  'S-01: direct authenticated profile update cannot assign Admin'
);
select throws_ok(
  $$update public.profiles
    set role_id = 'a0000000-0000-0000-0000-000000000003'
    where id = 'b1000000-0000-4000-8000-000000000002'$$,
  '42501', 'self_role_change_forbidden',
  'S-01: direct authenticated self role change is denied'
);
select is(
  (select role_id from public.profiles where id = 'b1000000-0000-4000-8000-000000000003'),
  'a0000000-0000-0000-0000-000000000003'::uuid,
  'S-01: denied promotion leaves target role unchanged'
);
select throws_ok(
  $$update public.profiles
    set role_id = 'a0000000-0000-0000-0000-000000000002'
    where id = 'b1000000-0000-4000-8000-000000000003'$$,
  '42501', 'role_assignment_forbidden',
  'S-01: role with unheld permissions is denied even when unprotected'
);
select ok(not has_table_privilege('authenticated', 'public.profile_role_changes', 'SELECT'),
  'S-01: clients cannot alter the role-change log');
select ok(not has_table_privilege('service_role', 'public.profile_role_changes', 'DELETE'),
  'S-01: application service key cannot erase the role-change log');

select set_config('request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-4000-8000-000000000004', 'role', 'authenticated')::text,
  true);
select lives_ok(
  $$update public.profiles
    set role_id = 'a0000000-0000-0000-0000-000000000001'
    where id = 'b1000000-0000-4000-8000-000000000003'$$,
  'S-01: Admin may assign Admin'
);
reset role;
select is(
  (select count(*)::integer from public.profile_role_changes
   where profile_id = 'b1000000-0000-4000-8000-000000000003'
     and actor_id = 'b1000000-0000-4000-8000-000000000004'
     and new_role_id = 'a0000000-0000-0000-0000-000000000001'),
  1,
  'S-01: successful role assignment is logged with actor'
);
select * from finish();
rollback;
