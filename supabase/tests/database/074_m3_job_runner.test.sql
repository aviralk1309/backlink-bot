begin;
select plan(30);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
--
-- Other queued jobs would be picked up and other running jobs would be
-- completed by the functions under test, so park them first. Everything is
-- rolled back at the end.
--
-- Jobs (n -> id 50000000-0000-0000-0000-00000000000n):
--   1 queued, valid       2 queued, valid       3 queued, bad config
--   4 running, no rows    5 running, pending row
--   6 running, running row
--   7 running, only done/skipped/failed rows
--   8 saturated, no rows  9 paused, no rows     10 draft
-- Pick-up order is created_at: job 1, then 3, then 2.
-- ---------------------------------------------------------------------
update public.jobs set status = 'paused' where status = 'running';
update public.jobs set status = 'draft' where status = 'queued';

create function pg_temp.j(n int) returns uuid
language sql
as $$
  select ('50000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into public.jobs (id, name)
select pg_temp.j(n), 'M3 S7 job ' || n from generate_series(1, 10) n;

-- Valid config for every fixture job, while they are still Draft.
update public.jobs
   set client_domain = 'client.com',
       business_type = 'gaming',
       country = 'US',
       language = 'en',
       seed_keywords = array['keyword'],
       activity_keys = array['guest_post'],
       budget_credits = 100
 where id in (select pg_temp.j(n) from generate_series(1, 10) n);

-- Job 3 has a bad config.
update public.jobs set seed_keywords = '{}' where id = pg_temp.j(3);

update public.jobs j
   set status = v.s::public.job_status
  from (values
    (1, 'queued'), (2, 'queued'), (3, 'queued'),
    (4, 'running'), (5, 'running'), (6, 'running'), (7, 'running'),
    (8, 'saturated'), (9, 'paused')
  ) as v(n, s)
 where j.id = pg_temp.j(v.n);

update public.jobs set created_at = timestamptz '2026-01-01 00:00:01+00' where id = pg_temp.j(1);
update public.jobs set created_at = timestamptz '2026-01-01 00:00:02+00' where id = pg_temp.j(3);
update public.jobs set created_at = timestamptz '2026-01-01 00:00:03+00' where id = pg_temp.j(2);

insert into public.opportunities (
  job_id, original_url, normalized_url, host, domain, first_source_type,
  priority, config_version, check_status, check_reason, locked_by, lease_expires_at
)
select
  pg_temp.j(v.n), v.label, 'https://example.com/' || v.label, 'example.com', 'example.com',
  'google', 2, 1,
  v.status::public.opportunity_check_status,
  case when v.status in ('skipped', 'failed') then 'fixture' end,
  case when v.status = 'running' then 'w1' end,
  case when v.status = 'running' then now() + interval '1 minute' end
from (values
  (5, 'p5', 'pending'),
  (6, 'r6', 'running'),
  (7, 'd7', 'done'),
  (7, 's7', 'skipped'),
  (7, 'f7', 'failed')
) as v(n, label, status);

create function pg_temp.as_role(p_role text, p_sql text) returns text
language plpgsql
as $$
declare
  r text;
begin
  execute format('set local role %I', p_role);
  execute p_sql into r;
  reset role;
  return r;
end;
$$;

-- 'job_id,outcome' per picked job, joined with ';'. Empty string when none.
create function pg_temp.pick() returns text
language sql
as $$
  select pg_temp.as_role('worker',
    $q$select coalesce(string_agg(p.job_id::text || ',' || p.outcome, ';'), '')
         from public.worker_pick_up_next_job() as p$q$)
$$;

-- Completed job ids, sorted, joined with ','. Empty string when none.
create function pg_temp.sweep() returns text
language sql
as $$
  select pg_temp.as_role('worker',
    $q$select coalesce(string_agg(t.id::text, ',' order by t.id::text), '')
         from public.worker_complete_drained_jobs() as t(id)$q$)
$$;

-- 'status|reason', '-' when there is no reason
create function pg_temp.st(n int) returns text
language sql
as $$
  select status::text || '|' || coalesce(status_reason, '-')
  from public.jobs where id = pg_temp.j(n)
$$;

-- ---------------------------------------------------------------------
-- A. job_work_pending: the single definition of "work left"
-- ---------------------------------------------------------------------
select is(public.job_work_pending(pg_temp.j(5))::text, '{checks_pending}',
  'a pending row is work left');
select is(public.job_work_pending(pg_temp.j(6))::text, '{checks_pending}',
  'a running row is work left');
select is(public.job_work_pending(pg_temp.j(7))::text, '{}',
  'done, skipped and failed rows are not work left');
select is(public.job_work_pending(pg_temp.j(4))::text, '{}',
  'a job with no rows has no work left');

-- ---------------------------------------------------------------------
-- B. worker_complete_drained_jobs
-- ---------------------------------------------------------------------
select is(pg_temp.sweep(), pg_temp.j(4)::text || ',' || pg_temp.j(7)::text,
  'drained running jobs complete, others are left');
select is(pg_temp.st(4) || ',' || pg_temp.st(7), 'completed|drained,completed|drained',
  'completed jobs carry the reason drained');
select ok(
  (select finished_at is not null from public.jobs where id = pg_temp.j(4)),
  'finished_at is set');
select is(
  (select count(*)::int from public.job_events
   where job_id = pg_temp.j(4) and type = 'status_changed'
     and payload ->> 'action' = 'complete'),
  1, 'the completion is in the activity log');
select is(pg_temp.st(5) || ',' || pg_temp.st(6), 'running|-,running|-',
  'jobs with pending or running rows keep running');
select is(pg_temp.st(8) || ',' || pg_temp.st(9), 'saturated|-,paused|-',
  'saturated and paused jobs are never completed, even when drained (G3)');
select is(pg_temp.sweep(), '', 'sweeping again completes nothing');

update public.opportunities
   set check_status = 'done', locked_by = null, lease_expires_at = null
 where original_url = 'p5';
select is(pg_temp.sweep(), pg_temp.j(5)::text,
  'job 5 completes once its pending row is done');
select is(pg_temp.st(6), 'running|-', 'job 6 still has its running row');

update public.opportunities
   set check_status = 'done', locked_by = null, lease_expires_at = null
 where original_url = 'r6';
select is(pg_temp.sweep(), pg_temp.j(6)::text,
  'job 6 completes once its running row is done');

-- ---------------------------------------------------------------------
-- C. worker_pick_up_next_job
-- ---------------------------------------------------------------------
select is(pg_temp.pick(), pg_temp.j(1)::text || ',running',
  'oldest queued job is picked up and runs');
select is(pg_temp.st(1), 'running|-', 'status is running, no reason');
select ok(
  (select started_at is not null from public.jobs where id = pg_temp.j(1)),
  'started_at is set');
select is(
  (select count(*)::int from public.job_events
   where job_id = pg_temp.j(1) and type = 'status_changed'
     and payload ->> 'action' = 'pick_up'),
  1, 'the pick-up is in the activity log');

select is(pg_temp.pick(), pg_temp.j(3)::text || ',failed',
  'a queued job with a bad config fails at pick-up (G2)');
select is(pg_temp.st(3), 'failed|bad_config:missing_seed_keywords',
  'the failure reason names the problem (I3)');
select ok(
  (select finished_at is not null from public.jobs where id = pg_temp.j(3)),
  'a failed job has finished_at');

select is(pg_temp.pick(), pg_temp.j(2)::text || ',running', 'next queued job is picked up');
select is(pg_temp.pick(), '', 'empty queue: nothing is picked up');
select is(pg_temp.st(9) || ',' || pg_temp.st(10), 'paused|-,draft|-',
  'paused and draft jobs are never picked up');
select is(
  (select count(*)::int from public.job_events
   where job_id = pg_temp.j(3) and type = 'status_changed'
     and payload ->> 'action' = 'fail'),
  1, 'the failure is in the activity log');

-- ---------------------------------------------------------------------
-- D. Execute rights (I12) and index
-- ---------------------------------------------------------------------
select ok(
  has_function_privilege('worker', 'public.job_work_pending(uuid)', 'execute')
  and has_function_privilege('worker', 'public.worker_pick_up_next_job()', 'execute')
  and has_function_privilege('worker', 'public.worker_complete_drained_jobs()', 'execute'),
  'worker can execute all three runner functions');
select is(
  (select count(*)::int
   from (values ('anon'), ('authenticated'), ('service_role')) r(name)
   cross join (values
     ('public.job_work_pending(uuid)'),
     ('public.worker_pick_up_next_job()'),
     ('public.worker_complete_drained_jobs()')
   ) f(sig)
   where has_function_privilege(r.name, f.sig, 'execute')),
  0, 'no browser-facing role can execute any of them');
select throws_like(
  $$select pg_temp.as_role('authenticated',
      $q$select count(*)::text from public.worker_pick_up_next_job()$q$)$$,
  'permission denied for function worker_pick_up_next_job%',
  'a signed-in user cannot pick up jobs');
select throws_like(
  $$select pg_temp.as_role('authenticated',
      $q$select count(*)::text from public.worker_complete_drained_jobs()$q$)$$,
  'permission denied for function worker_complete_drained_jobs%',
  'a signed-in user cannot complete jobs');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'opportunities_job_open_idx'
  ),
  'the open-work index exists');

select * from finish();
rollback;