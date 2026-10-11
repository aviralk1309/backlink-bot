begin;
select plan(4);

-- The SQL tests assume the freshly migrated database: no users, the three
-- starter roles, seeded grants. If this file fails, the rest will too, for the
-- same reason. Run `make db-verify` (resets, then tests).

select is(
  (select count(*)::int from auth.users),
  0,
  'pristine database: no users exist. Run make db-verify'
);

select is(
  (select array_agg(id order by id) from public.roles),
  array[
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003'
  ]::uuid[],
  'pristine database: only the three starter roles exist. Run make db-verify'
);

select is(
  (select count(*)::int from public.role_permissions),
  33,
  'pristine database: seeded grants unchanged (20 + 10 + 3). Run make db-verify'
);

select is(
  (select count(*)::int from public.role_permissions
    where role_id = 'a0000000-0000-0000-0000-000000000002'),
  10,
  'pristine database: Manager still has its seeded 10 permissions. Run make db-verify'
);

select * from finish();
rollback;