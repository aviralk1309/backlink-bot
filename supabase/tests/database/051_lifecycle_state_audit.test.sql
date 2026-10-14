begin;
select plan(76);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
-- u_admin, u_manager, u_viewer
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'admin_p5@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'manager_p5@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'viewer_p5@test.local');

update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set status = 'active',
  role_id = 'a0000000-0000-0000-0000-000000000003'
  where id = '00000000-0000-0000-0000-0000000000b3';

insert into public.activity_profiles (key, name, enabled) values
  ('p5_active_act', 'P5 Active', true),
  ('p5_disabled_act', 'P5 Disabled', false);

-- Helper to set authenticated user context
create or replace function pg_temp.as_user(p_uid text) returns void as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- Fixture jobs inserted under postgres
insert into public.jobs (
  id, name, client_domain, business_type, country, language,
  seed_keywords, activity_keys, budget_credits
) values (
  '11111111-0000-0000-0000-000000000001', 'P5 Base Valid',
  'example.com', 'SaaS', 'US', 'en',
  array['seo', 'backlinks'], array['p5_active_act'], 50
);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000002', 'P5 No Domain', '   ', 'SaaS', 'US', 'en', array['k'], array['p5_active_act'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000003', 'P5 No Biz', 'example.com', '', 'US', 'en', array['k'], array['p5_active_act'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000004', 'P5 No Country', 'example.com', 'SaaS', null, 'en', array['k'], array['p5_active_act'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000005', 'P5 No Lang', 'example.com', 'SaaS', 'US', null, array['k'], array['p5_active_act'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000006', 'P5 No Kw', 'example.com', 'SaaS', 'US', 'en', '{}', array['p5_active_act'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000007', 'P5 No Act', 'example.com', 'SaaS', 'US', 'en', array['k'], '{}', 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000008', 'P5 Bad Act', 'example.com', 'SaaS', 'US', 'en', array['k'], array['nonexistent_activity'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000009', 'P5 Off Act', 'example.com', 'SaaS', 'US', 'en', array['k'], array['p5_disabled_act'], 10);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('11111111-0000-0000-0000-000000000010', 'P5 No Source', 'example.com', 'SaaS', 'US', 'en', array['k'], array['p5_active_act'], 0);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits, seed_list_urls)
values ('11111111-0000-0000-0000-000000000011', 'P5 Seed URLs', 'example.com', 'SaaS', 'US', 'en', array['k'], array['p5_active_act'], 0, array['https://seed.com/list']);

insert into public.jobs (id, name, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits, competitor_domains)
values ('11111111-0000-0000-0000-000000000012', 'P5 Competitors', 'example.com', 'SaaS', 'US', 'en', array['k'], array['p5_active_act'], 0, array['comp.com']);

insert into public.jobs (
  id, name, client_domain, business_type, country, language,
  seed_keywords, activity_keys, budget_credits
) values (
  '22222222-0000-0000-0000-000000000001', 'P5 Matrix Job',
  'testmatrix.com', 'FinTech', 'GB', 'en',
  array['fintech', 'banking'], array['p5_active_act'], 100
);

-- ---------------------------------------------------------------------
-- Part 1: Start Pre-condition Validations (job_start_problems) (14 tests)
-- ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

select is(
  public.job_start_problems('11111111-0000-0000-0000-000000000001'),
  '{}'::text[],
  'fully configured job has 0 problems'
);

select ok('missing_client_domain' = any(public.job_start_problems('11111111-0000-0000-0000-000000000002')), 'detects missing client domain');
select ok('missing_business_type' = any(public.job_start_problems('11111111-0000-0000-0000-000000000003')), 'detects missing business type');
select ok('missing_country' = any(public.job_start_problems('11111111-0000-0000-0000-000000000004')), 'detects missing country');
select ok('missing_language' = any(public.job_start_problems('11111111-0000-0000-0000-000000000005')), 'detects missing language');
select ok('missing_seed_keywords' = any(public.job_start_problems('11111111-0000-0000-0000-000000000006')), 'detects missing seed keywords');
select ok('no_activity' = any(public.job_start_problems('11111111-0000-0000-0000-000000000007')), 'detects no activity');
select ok('activity_unknown' = any(public.job_start_problems('11111111-0000-0000-0000-000000000008')), 'detects unknown activity');
select ok('activity_disabled' = any(public.job_start_problems('11111111-0000-0000-0000-000000000009')), 'detects disabled activity');
select ok('no_source' = any(public.job_start_problems('11111111-0000-0000-0000-000000000010')), 'detects no source when budget is 0');
select ok(not ('no_source' = any(public.job_start_problems('11111111-0000-0000-0000-000000000011'))), 'seed_list_urls satisfies source constraint');
select ok(not ('no_source' = any(public.job_start_problems('11111111-0000-0000-0000-000000000012'))), 'competitor_domains satisfies source constraint');

-- Non-existent job raises exception
select throws_ok(
  $$select public.job_start_problems('99999999-9999-9999-9999-999999999999')$$,
  'P0001', 'job_not_found',
  'job_start_problems throws for non-existent job'
);

-- Starting unready job throws aggregated problems
select throws_like(
  $$select public.transition_job('11111111-0000-0000-0000-000000000010', 'start')$$,
  'job_not_ready:no_source%',
  'transition_job raises job_not_ready error message'
);

-- ---------------------------------------------------------------------
-- Part 2: Prohibited User & Worker Transitions (20 tests)
-- ---------------------------------------------------------------------

-- In Draft:
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'pause')$$, 'invalid_transition%', 'draft cannot pause');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'resume')$$, 'invalid_transition%', 'draft cannot resume');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'stop')$$, 'invalid_transition%', 'draft cannot stop');

-- Move to Queued
select lives_ok($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'start')$$, 'start moves draft to queued');

-- In Queued:
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'start')$$, 'invalid_transition%', 'queued cannot start again');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'pause')$$, 'invalid_transition%', 'queued cannot pause');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'resume')$$, 'invalid_transition%', 'queued cannot resume');

-- Switch to worker (reset role) to test worker transitions on Queued
reset role;
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'complete')$$, 'invalid_transition%', 'worker cannot complete queued');
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'saturate')$$, 'invalid_transition%', 'worker cannot saturate queued');

-- Worker picks up -> Running
select lives_ok($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'pick_up')$$, 'worker picks up queued');

-- In Running:
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'pick_up')$$, 'invalid_transition%', 'worker cannot pick up running');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'start')$$, 'invalid_transition%', 'running cannot start');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'resume')$$, 'invalid_transition%', 'running cannot resume');

-- Pause -> Paused
select lives_ok($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'pause')$$, 'pause moves running to paused');

-- In Paused:
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'start')$$, 'invalid_transition%', 'paused cannot start');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'pause')$$, 'invalid_transition%', 'paused cannot pause');

reset role;
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'pick_up')$$, 'invalid_transition%', 'worker cannot pick up paused');
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'complete')$$, 'invalid_transition%', 'worker cannot complete paused');
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'saturate')$$, 'invalid_transition%', 'worker cannot saturate paused');
select throws_like($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'fail')$$, 'invalid_transition%', 'worker cannot fail paused');

-- Resume -> Running -> Worker Saturate -> Saturated
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'resume')$$, 'resume moves paused to running');

reset role;
select lives_ok($$select public.worker_transition_job('22222222-0000-0000-0000-000000000001', 'saturate')$$, 'worker saturates running');

-- ---------------------------------------------------------------------
-- Part 3: Saturated Resume & Terminal State Immutability (10 tests)
-- ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select status::text from public.jobs where id = '22222222-0000-0000-0000-000000000001'), 'saturated', 'job is in saturated state');

-- Saturated can be resumed
select lives_ok($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'resume')$$, 'saturated job can resume to running');
select is((select status::text from public.jobs where id = '22222222-0000-0000-0000-000000000001'), 'running', 'job is running again');

-- Stop with long reason to test 200 char truncation
select lives_ok(
  $$select public.transition_job('22222222-0000-0000-0000-000000000001', 'stop', repeat('Stop reason test ', 25))$$,
  'stop running job with reason'
);

select is((select status::text from public.jobs where id = '22222222-0000-0000-0000-000000000001'), 'stopped', 'job is now stopped');
select is(
  (select length(status_reason) from public.jobs where id = '22222222-0000-0000-0000-000000000001'),
  200,
  'status_reason truncated to max 200 chars'
);
select ok((select finished_at is not null from public.jobs where id = '22222222-0000-0000-0000-000000000001'), 'stopped sets finished_at');

-- Terminal stopped job cannot transition anywhere
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'start')$$, 'invalid_transition%', 'stopped cannot start');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'resume')$$, 'invalid_transition%', 'stopped cannot resume');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'pause')$$, 'invalid_transition%', 'stopped cannot pause');
select throws_like($$select public.transition_job('22222222-0000-0000-0000-000000000001', 'stop')$$, 'invalid_transition%', 'stopped cannot stop');

-- ---------------------------------------------------------------------
-- Part 4: Deletion Matrix Across States (8 tests)
-- ---------------------------------------------------------------------
reset role;
insert into public.jobs (id, name, status, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('33333333-0000-0000-0000-000000000001', 'P5 Del Queued', 'queued', 'del1.com', 'SaaS', 'US', 'en', array['k'], array['p5_active_act'], 10);

insert into public.jobs (id, name, status, client_domain, business_type, country, language, seed_keywords, activity_keys, budget_credits)
values ('33333333-0000-0000-0000-000000000002', 'P5 Del Running', 'running', 'del2.com', 'SaaS', 'US', 'en', array['k'], array['p5_active_act'], 10);

insert into public.jobs (id, name, status) values ('33333333-0000-0000-0000-000000000003', 'P5 Del Draft', 'draft');
insert into public.jobs (id, name, status) values ('33333333-0000-0000-0000-000000000004', 'P5 Del Paused', 'paused');
insert into public.jobs (id, name, status) values ('33333333-0000-0000-0000-000000000005', 'P5 Del Saturated', 'saturated');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

-- Queued job cannot be deleted
delete from public.jobs where id = '33333333-0000-0000-0000-000000000001';
select ok(exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000001'), 'queued job delete blocked by RLS');

-- Running job cannot be deleted
delete from public.jobs where id = '33333333-0000-0000-0000-000000000002';
select ok(exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000002'), 'running job delete blocked by RLS');

-- Draft job can be deleted
delete from public.jobs where id = '33333333-0000-0000-0000-000000000003';
select ok(not exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000003'), 'draft job can be deleted');

-- Paused job can be deleted
delete from public.jobs where id = '33333333-0000-0000-0000-000000000004';
select ok(not exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000004'), 'paused job can be deleted');

-- Saturated job can be deleted
delete from public.jobs where id = '33333333-0000-0000-0000-000000000005';
select ok(not exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000005'), 'saturated job can be deleted');

-- Stopped job can be deleted
delete from public.jobs where id = '22222222-0000-0000-0000-000000000001';
select ok(not exists(select 1 from public.jobs where id = '22222222-0000-0000-0000-000000000001'), 'stopped job can be deleted');

-- Viewer role cannot delete job
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
delete from public.jobs where id = '33333333-0000-0000-0000-000000000001';
select ok(exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000001'), 'viewer delete blocked');

-- Manager role cannot delete job
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
delete from public.jobs where id = '33333333-0000-0000-0000-000000000001';
select ok(exists(select 1 from public.jobs where id = '33333333-0000-0000-0000-000000000001'), 'manager delete blocked');

-- ---------------------------------------------------------------------
-- Part 5: Multi-Step Config Versioning & Snapshot Immutability (10 tests)
-- ---------------------------------------------------------------------
reset role;
insert into public.jobs (
  id, name, client_domain, business_type, country, language,
  seed_keywords, activity_keys, budget_credits
) values (
  '44444444-0000-0000-0000-000000000001', 'P5 Versioning Job',
  'versioning.com', 'Agency', 'US', 'en',
  array['seo'], array['p5_active_act'], 50
);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

-- Start to freeze v1
select lives_ok($$select public.transition_job('44444444-0000-0000-0000-000000000001', 'start')$$, 'start freezes v1');

-- v1 snapshot exists
select is(
  (select snapshot ->> 'budget_credits' from public.job_config_history
    where job_id = '44444444-0000-0000-0000-000000000001' and version = 1),
  '50',
  'v1 snapshot stores budget 50'
);

-- First edit in queued state -> v2
update public.jobs set budget_credits = 75 where id = '44444444-0000-0000-0000-000000000001';
select is((select config_version from public.jobs where id = '44444444-0000-0000-0000-000000000001'), 2, 'config bumped to v2');

-- Second edit: change seed_keywords -> v3
update public.jobs set seed_keywords = array['seo', 'growth'] where id = '44444444-0000-0000-0000-000000000001';
select is((select config_version from public.jobs where id = '44444444-0000-0000-0000-000000000001'), 3, 'config bumped to v3');

-- Check snapshots in job_config_history: exactly 3 rows
select is(
  (select count(*)::int from public.job_config_history where job_id = '44444444-0000-0000-0000-000000000001'),
  3,
  'exactly 3 config snapshots recorded'
);

-- Immutability check: v1 snapshot still has original values
select is(
  (select snapshot -> 'seed_keywords' from public.job_config_history
    where job_id = '44444444-0000-0000-0000-000000000001' and version = 1),
  '["seo"]'::jsonb,
  'v1 snapshot unchanged'
);

-- v2 snapshot has budget 75 and seed_keywords ['seo']
select is(
  (select snapshot ->> 'budget_credits' from public.job_config_history
    where job_id = '44444444-0000-0000-0000-000000000001' and version = 2),
  '75',
  'v2 snapshot has budget 75'
);

-- v3 snapshot has seed_keywords ['seo', 'growth']
select is(
  (select snapshot -> 'seed_keywords' from public.job_config_history
    where job_id = '44444444-0000-0000-0000-000000000001' and version = 3),
  '["seo", "growth"]'::jsonb,
  'v3 snapshot has updated keywords'
);

-- No-op update does NOT bump version
update public.jobs set budget_credits = 75 where id = '44444444-0000-0000-0000-000000000001';
select is((select config_version from public.jobs where id = '44444444-0000-0000-0000-000000000001'), 3, 'no-op update keeps v3');

-- History table is not client-writable
select throws_ok(
  $$insert into public.job_config_history (job_id, version, snapshot) values ('44444444-0000-0000-0000-000000000001', 99, '{}')$$,
  '42501',
  'permission denied for table job_config_history',
  'direct insert to job_config_history rejected'
);

-- ---------------------------------------------------------------------
-- Part 6: Audit Trail (job_events) Integrity (10 tests)
-- ---------------------------------------------------------------------

-- Verify event sequence on job 44444444-0000-0000-0000-000000000001:
-- 1) created
select ok(
  exists(
    select 1 from public.job_events
     where job_id = '44444444-0000-0000-0000-000000000001'
       and type = 'created'
       and config_version = 1
  ),
  'created event logged with config_version 1'
);

-- 2) status_changed (start -> queued)
select ok(
  exists(
    select 1 from public.job_events
     where job_id = '44444444-0000-0000-0000-000000000001'
       and type = 'status_changed'
       and payload ->> 'action' = 'start'
       and payload ->> 'from' = 'draft'
       and payload ->> 'to' = 'queued'
       and actor = '00000000-0000-0000-0000-0000000000b1'
  ),
  'start transition logged with from/to and actor'
);

-- 3) config_changed (v1 -> v2)
select ok(
  exists(
    select 1 from public.job_events
     where job_id = '44444444-0000-0000-0000-000000000001'
       and type = 'config_changed'
       and (payload ->> 'from_version')::int = 1
       and config_version = 2
       and payload -> 'fields' = '["budget_credits"]'::jsonb
  ),
  'v1->v2 config_changed event logged fields and from_version'
);

-- 4) config_changed (v2 -> v3)
select ok(
  exists(
    select 1 from public.job_events
     where job_id = '44444444-0000-0000-0000-000000000001'
       and type = 'config_changed'
       and (payload ->> 'from_version')::int = 2
       and config_version = 3
       and payload -> 'fields' = '["seed_keywords"]'::jsonb
  ),
  'v2->v3 config_changed event logged fields and from_version'
);

-- 5) Stop event with reason
select lives_ok(
  $$select public.transition_job('44444444-0000-0000-0000-000000000001', 'stop', 'Audit verified')$$,
  'stop job for audit test'
);

select ok(
  exists(
    select 1 from public.job_events
     where job_id = '44444444-0000-0000-0000-000000000001'
       and type = 'status_changed'
       and payload ->> 'action' = 'stop'
       and payload ->> 'reason' = 'Audit verified'
       and config_version = 3
  ),
  'stop event records reason and current config_version'
);

-- Direct write / delete / update on job_events blocked for authenticated users
select throws_ok(
  $$insert into public.job_events (job_id, type) values ('44444444-0000-0000-0000-000000000001', 'tampered')$$,
  '42501',
  'permission denied for table job_events',
  'direct insert to job_events rejected'
);

select throws_ok(
  $$update public.job_events set payload = '{}' where job_id = '44444444-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table job_events',
  'direct update on job_events rejected'
);

select throws_ok(
  $$delete from public.job_events where job_id = '44444444-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table job_events',
  'direct delete on job_events rejected'
);

-- Viewer can select job_events
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select ok(
  (select count(*)::int from public.job_events where job_id = '44444444-0000-0000-0000-000000000001') > 0,
  'viewer can read job_events'
);

-- Viewer can select job_config_history
select ok(
  (select count(*)::int from public.job_config_history where job_id = '44444444-0000-0000-0000-000000000001') > 0,
  'viewer can read job_config_history'
);

reset role;
select * from finish();
rollback;
