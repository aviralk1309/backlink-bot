-- S-01: TODO until the database enforces the owner-approved D3 ceiling.
begin;
select plan(1);

insert into public.roles (id, name)
values ('b1000000-0000-4000-8000-000000000001', 'S01 Users Manager');
insert into public.role_permissions (role_id, permission_key)
values ('b1000000-0000-4000-8000-000000000001', 'users.manage');

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-000000000002', 's01-actor@test.local'),
  ('b1000000-0000-4000-8000-000000000003', 's01-target@test.local');
update public.profiles
set status = 'active', role_id = 'b1000000-0000-4000-8000-000000000001'
where id = 'b1000000-0000-4000-8000-000000000002';
update public.profiles
set status = 'active', role_id = 'a0000000-0000-0000-0000-000000000003'
where id = 'b1000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true);
select todo_start('S-01: users.manage-only account can promote another user to Admin');
select is_empty(
  $$update public.profiles
    set role_id = 'a0000000-0000-0000-0000-000000000001'
    where id = 'b1000000-0000-4000-8000-000000000003'
    returning id$$,
  'S-01: direct authenticated profile update must not assign Admin'
);
select todo_end();
select * from finish();
rollback;
