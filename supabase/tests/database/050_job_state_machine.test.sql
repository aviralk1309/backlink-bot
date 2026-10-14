begin;
select plan(48);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
-- a1 admin, a2 manager (no jobs.start / jobs.control), a3 viewer
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000a3';

insert into public.activity_profiles (key, name, enabled) values
  ('test_activity', 'Test activity', true),
  ('off_activity', 'Off activity', false);

insert into public.jobs
  (name, client_domain, business_type, country, language,
   seed_keywords, activity_keys, budget_credits)
values
  ('Ready job', 'client.com', 'travel', 'IN', 'en',
   array['yoga'], array['test_activity'], 100);
insert into public.jobs (name) values ('Empty draft');
insert into public.jobs (name, activity_keys) values
  ('Unknown act job', array['nope']),
  ('Disabled act job', array['off_activity']);

-- ---------------------------------------------------------------------
-- A. Pure transition table and privileges (7)
-- ---------------------------------------------------------------------
select is(
  (with grid as (
     select s, a
     from unnest(enum_range(null::public.job_status)) as s
     cross join unnest(array['start','pick_up','pause','resume','stop',
                             'complete','saturate','fail']) as a
   ),
   legal(s, a, t) as (values
     ('draft','start','queued'),
     ('queued','pick_up','running'),
     ('running','pause','paused'),
     ('paused','resume','running'),
     ('saturated','resume','running'),
     ('queued','stop','stopped'),
     ('running','stop','stopped'),
     ('paused','stop','stopped'),
     ('saturated','stop','stopped'),
     ('running','complete','completed'),
     ('running','saturate','saturated'),
     ('queued','fail','failed'),
     ('running','fail','failed'))
   select count(*)::int
   from grid g
   left join legal l on l.s = g.s::text and l.a = g.a
   where public.job_transition_target(g.s, g.a)
         is distinct from l.t::public.job_status),
  0,
  'every cell of the transition table matches the spec'
);
select is(
  (select count(*)::int
   from unnest(enum_range(null::public.job_status)) as s
   cross join unnest(array['start','pick_up','pause','resume','stop',
                           'complete','saturate','fail']) as a
   where public.job_transition_target(s, a) is not null),
  13,
  'exactly 13 transitions are legal'
);
select ok(public.job_transition_target('draft', 'nonsense') is null,
  'an unknown action is never legal');
select ok(not has_function_privilege('anon', 'public.transition_job(uuid,text,text)', 'execute'),
  'anon cannot call transition_job');
select ok(has_function_privilege('authenticated', 'public.transition_job(uuid,text,text)', 'execute'),
  'signed-in users can call transition_job');
select ok(
  not has_function_privilege('authenticated', 'public.worker_transition_job(uuid,text,text)', 'execute'),
  'signed-in users cannot call worker_transition_job');
select ok(
  not has_function_privilege('anon', 'public.worker_transition_job(uuid,text,text)', 'execute'),
  'anon cannot call worker_transition_job');

set local role authenticated;

-- ---------------------------------------------------------------------
-- B. Start readiness as Admin (6)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select ok(
  'missing_client_domain' = any (public.job_start_problems(
    (select id from public.jobs where name = 'Empty draft'))),
  'empty draft is missing a client domain'
);
select ok(
  'no_activity' = any (public.job_start_problems(
    (select id from public.jobs where name = 'Empty draft'))),
  'empty draft has no activity'
);
select ok(
  'no_source' = any (public.job_start_problems(
    (select id from public.jobs where name = 'Empty draft'))),
  'empty draft has no source'
);
select ok(
  'activity_unknown' = any (public.job_start_problems(
    (select id from public.jobs where name = 'Unknown act job'))),
  'an unknown activity key is reported'
);
select ok(
  'activity_disabled' = any (public.job_start_problems(
    (select id from public.jobs where name = 'Disabled act job'))),
  'a disabled activity is reported'
);
select is(
  public.job_start_problems((select id from public.jobs where name = 'Ready job')),
  '{}'::text[],
  'a complete job has no start problems'
);

-- ---------------------------------------------------------------------
-- C. Permissions (4)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'start')$$,
  '42501', 'forbidden',
  'viewer cannot start a job'
);
select throws_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'stop')$$,
  '42501', 'forbidden',
  'viewer cannot stop a job'
);
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'start')$$,
  '42501', 'forbidden',
  'manager cannot start a job'
);
select throws_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'stop')$$,
  '42501', 'forbidden',
  'manager cannot stop a job'
);

-- ---------------------------------------------------------------------
-- D. Start as Admin (9)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select throws_like(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Empty draft'), 'start')$$,
  'job_not_ready:%',
  'an incomplete job cannot start'
);
select is(
  (select status::text from public.jobs where name = 'Empty draft'),
  'draft',
  'the incomplete job is still a draft'
);
select lives_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'start')$$,
  'a complete job can start'
);
select is(
  (select status::text from public.jobs where name = 'Ready job'),
  'queued',
  'a started job is queued'
);
select is(
  (select count(*)::int from public.job_config_history
    where job_id = (select id from public.jobs where name = 'Ready job')
      and version = 1),
  1,
  'start stores the version 1 config snapshot'
);
select is(
  (select actor from public.job_events
    where job_id = (select id from public.jobs where name = 'Ready job')
      and type = 'status_changed'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'the start event records who did it'
);
select throws_like(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'start')$$,
  'invalid_transition%',
  'a queued job cannot start again'
);
select throws_like(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'pause')$$,
  'invalid_transition%',
  'a queued job cannot be paused'
);
select throws_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'complete')$$,
  'P0001', 'invalid_action',
  'users cannot use worker actions'
);

-- ---------------------------------------------------------------------
-- E. Worker (4), run as the database owner like the real worker
-- ---------------------------------------------------------------------
reset role;
select lives_ok(
  $$select public.worker_transition_job(
      (select id from public.jobs where name = 'Ready job'), 'pick_up')$$,
  'worker can pick up a queued job'
);
select is(
  (select status::text from public.jobs where name = 'Ready job'),
  'running',
  'a picked up job is running'
);
select ok(
  (select started_at is not null from public.jobs where name = 'Ready job'),
  'pick up sets started_at'
);
select throws_ok(
  $$select public.worker_transition_job(
      (select id from public.jobs where name = 'Ready job'), 'start')$$,
  'P0001', 'invalid_action',
  'the worker cannot use user actions'
);

set local role authenticated;

-- ---------------------------------------------------------------------
-- F. Pause, resume, versioned edits, stop as Admin (18)
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'pause')$$,
  'admin can pause a running job'
);
select is(
  (select status::text from public.jobs where name = 'Ready job'),
  'paused',
  'the job is paused'
);
select lives_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'resume')$$,
  'admin can resume a paused job'
);
select is(
  (select status::text from public.jobs where name = 'Ready job'),
  'running',
  'the job is running again'
);
select is(
  (select config_version from public.jobs where name = 'Ready job'),
  1,
  'status changes never bump the config version'
);
select lives_ok(
  $$update public.jobs set seed_keywords = array['yoga', 'retreat']
      where name = 'Ready job'$$,
  'admin can edit a running job'
);
select is(
  (select config_version from public.jobs where name = 'Ready job'),
  2,
  'editing a started job bumps the config version'
);
select is(
  (select count(*)::int from public.job_config_history
    where job_id = (select id from public.jobs where name = 'Ready job')
      and version = 2),
  1,
  'the new version has a snapshot'
);
select is(
  (select snapshot -> 'seed_keywords' from public.job_config_history
    where job_id = (select id from public.jobs where name = 'Ready job')
      and version = 1),
  '["yoga"]'::jsonb,
  'the old snapshot is never rewritten (I8)'
);
select is(
  (select count(*)::int from public.job_events
    where job_id = (select id from public.jobs where name = 'Ready job')
      and type = 'config_changed'),
  1,
  'the edit is logged as a config change'
);
select lives_ok(
  $$update public.jobs set client = 'Acme' where name = 'Empty draft'$$,
  'admin can edit a draft'
);
select is(
  (select config_version from public.jobs where name = 'Empty draft'),
  1,
  'editing a draft does not bump the config version'
);
select is(
  (select count(*)::int from public.job_events
    where job_id = (select id from public.jobs where name = 'Empty draft')
      and type = 'edited'),
  1,
  'the draft edit is logged'
);
select lives_ok(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'stop')$$,
  'admin can stop a running job'
);
select is(
  (select status::text from public.jobs where name = 'Ready job'),
  'stopped',
  'the job is stopped'
);
select ok(
  (select finished_at is not null from public.jobs where name = 'Ready job'),
  'stop sets finished_at'
);
select throws_like(
  $$select public.transition_job(
      (select id from public.jobs where name = 'Ready job'), 'stop')$$,
  'invalid_transition%',
  'a stopped job cannot be stopped again'
);
select is(
  (select count(*)::int from public.job_events
    where job_id = (select id from public.jobs where name = 'Ready job')
      and type = 'status_changed'),
  5,
  'every transition wrote one event (start, pick up, pause, resume, stop)'
);

reset role;
select * from finish();
rollback;