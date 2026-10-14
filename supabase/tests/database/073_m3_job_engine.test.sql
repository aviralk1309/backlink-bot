begin;
select plan(43);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
--
-- Jobs (statuses are set directly, the state machine is tested in 050):
--   01 running, 02 saturated   -> claimable (G4)
--   03 paused, 04 stopped, 05 queued, 06 draft, 07 completed -> never claimed
--
-- Every opportunity has original_url = its label, so tests read labels.
-- created_at is explicit: now() is the same for the whole transaction.
-- Claim order: priority, then created_at.
--   job 01: g1 (gap, seq 3), g2 (gap, seq 4), s1 (seed), q1 (search)
--   job 02: sat1 (search)
-- Calls under test run as the `worker` role through pg_temp.as_role().
-- Concurrent claims (SKIP LOCKED) cannot be tested in one transaction: they
-- are covered by the Python integration test (M3-S6 step 3).
-- ---------------------------------------------------------------------
insert into public.jobs (id, name) values
  ('40000000-0000-0000-0000-000000000001', 'M3 S6 running'),
  ('40000000-0000-0000-0000-000000000002', 'M3 S6 saturated'),
  ('40000000-0000-0000-0000-000000000003', 'M3 S6 paused'),
  ('40000000-0000-0000-0000-000000000004', 'M3 S6 stopped'),
  ('40000000-0000-0000-0000-000000000005', 'M3 S6 queued'),
  ('40000000-0000-0000-0000-000000000006', 'M3 S6 draft'),
  ('40000000-0000-0000-0000-000000000007', 'M3 S6 completed');

update public.jobs j
   set status = v.s::public.job_status
  from (values
    ('40000000-0000-0000-0000-000000000001', 'running'),
    ('40000000-0000-0000-0000-000000000002', 'saturated'),
    ('40000000-0000-0000-0000-000000000003', 'paused'),
    ('40000000-0000-0000-0000-000000000004', 'stopped'),
    ('40000000-0000-0000-0000-000000000005', 'queued'),
    ('40000000-0000-0000-0000-000000000007', 'completed')
  ) as v(id, s)
 where j.id = v.id::uuid;

insert into public.opportunities (
  job_id, original_url, normalized_url, host, domain, first_source_type,
  priority, config_version, created_at, check_status, check_reason
)
select
  v.job::uuid, v.label, 'https://example.com/' || v.label, 'example.com', 'example.com',
  'google', v.prio, 1,
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => v.seq),
  v.status::public.opportunity_check_status,
  case when v.status in ('skipped', 'failed') then 'fixture' end
from (values
  ('40000000-0000-0000-0000-000000000001', 'g1',  0, 3, 'pending'),
  ('40000000-0000-0000-0000-000000000001', 'g2',  0, 4, 'pending'),
  ('40000000-0000-0000-0000-000000000001', 's1',  1, 2, 'pending'),
  ('40000000-0000-0000-0000-000000000001', 'q1',  2, 1, 'pending'),
  ('40000000-0000-0000-0000-000000000001', 'dn1', 0, 0, 'done'),
  ('40000000-0000-0000-0000-000000000001', 'sk1', 0, 0, 'skipped'),
  ('40000000-0000-0000-0000-000000000001', 'fl1', 0, 0, 'failed'),
  ('40000000-0000-0000-0000-000000000002', 'sat1', 2, 5, 'pending'),
  ('40000000-0000-0000-0000-000000000003', 'pa1', 0, 0, 'pending'),
  ('40000000-0000-0000-0000-000000000004', 'st1', 0, 0, 'pending'),
  ('40000000-0000-0000-0000-000000000005', 'qu1', 0, 0, 'pending'),
  ('40000000-0000-0000-0000-000000000006', 'dr1', 0, 0, 'pending'),
  ('40000000-0000-0000-0000-000000000007', 'co1', 0, 0, 'pending')
) as v(job, label, prio, seq, status);

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

-- Labels claimed, sorted (UPDATE ... RETURNING order is not defined).
create function pg_temp.claim(p_worker text, p_batch int, p_lease int) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select coalesce(string_agg(original_url, ',' order by original_url), '')
         from public.claim_opportunity_checks(%L, %s, %s)$q$,
    p_worker, p_batch, p_lease))
$$;

-- Labels whose lease was extended. p_labels is a text array literal: '{g1,g2}'.
create function pg_temp.ext(p_worker text, p_labels text, p_secs int) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select coalesce(string_agg(o.original_url, ',' order by o.original_url), '')
         from public.extend_opportunity_leases(
                %L,
                (select array_agg(x.id) from public.opportunities x
                  where x.original_url = any (%L::text[])),
                %s) as e(id)
         join public.opportunities o on o.id = e.id$q$,
    p_worker, p_labels, p_secs))
$$;

create function pg_temp.rel(p_worker text) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select public.release_opportunity_claims(%L)::text$q$, p_worker))
$$;

-- 'requeued,failed'
create function pg_temp.reap(p_max int, p_limit int) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select requeued::text || ',' || failed::text
         from public.reap_expired_leases(%s, %s)$q$,
    p_max, p_limit))
$$;

-- 'status|locked_by|attempts|reason|lease', '-' for null
create function pg_temp.row(p_label text) returns text
language sql
as $$
  select concat_ws('|',
    check_status, coalesce(locked_by, '-'), attempts, coalesce(check_reason, '-'),
    case when lease_expires_at is null then 'nolease' else 'lease' end)
  from public.opportunities where original_url = p_label
$$;

-- ---------------------------------------------------------------------
-- A. Claim: order, lease, which jobs and rows are eligible
-- ---------------------------------------------------------------------
select is(pg_temp.claim('w1', 1, 120), 'g1',
  'batch of 1 takes the best row: gap source, oldest first (I6)');
select is(pg_temp.row('g1'), 'running|w1|1|-|lease',
  'claimed row is running, owned, attempt 1, leased');
select ok(
  (select lease_expires_at = now() + interval '120 seconds'
   from public.opportunities where original_url = 'g1'),
  'lease is now + lease_seconds');

select is(pg_temp.claim('w2', 2, 60), 'g2,s1',
  'next batch: rest of gap, then seed, before search rows');
select is(pg_temp.row('s1'), 'running|w2|1|-|lease', 'second worker owns its rows');

select is(pg_temp.claim('w3', 5, 120), 'q1,sat1',
  'search rows last, and a saturated job is claimable (G4)');
select is(pg_temp.claim('w4', 5, 120), '', 'nothing left to claim');

select is(
  (select count(*)::int from public.opportunities
   where job_id in (
     '40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004',
     '40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000006',
     '40000000-0000-0000-0000-000000000007')
     and check_status = 'pending'),
  5, 'paused, stopped, queued, draft and completed jobs are never claimed');
select is(
  (select string_agg(original_url || ':' || check_status, ',' order by original_url)
   from public.opportunities where original_url in ('dn1', 'sk1', 'fl1')),
  'dn1:done,fl1:failed,sk1:skipped',
  'done, skipped and failed rows are not claimed');

-- ---------------------------------------------------------------------
-- B. Pause blocks claims, resume allows them
-- ---------------------------------------------------------------------
update public.jobs set status = 'paused' where id = '40000000-0000-0000-0000-000000000001';
insert into public.opportunities (
  job_id, original_url, normalized_url, host, domain, first_source_type,
  priority, config_version, created_at
) values (
  '40000000-0000-0000-0000-000000000001', 'pp1', 'https://example.com/pp1',
  'example.com', 'example.com', 'google', 2, 1, timestamptz '2026-01-01 00:00:06+00'
);
select is(pg_temp.claim('w5', 5, 120), '', 'paused job: no claims');
update public.jobs set status = 'running' where id = '40000000-0000-0000-0000-000000000001';
select is(pg_temp.claim('w5', 5, 120), 'pp1', 'resumed job: claims again');

-- ---------------------------------------------------------------------
-- C. Argument validation
-- ---------------------------------------------------------------------
select throws_like($$select pg_temp.claim('', 1, 120)$$, 'invalid_worker_id%',
  'blank worker id is refused');
select throws_like($$select pg_temp.claim('w1', 0, 120)$$, 'invalid_batch%',
  'batch 0 is refused');
select throws_like($$select pg_temp.claim('w1', 101, 120)$$, 'invalid_batch%',
  'batch above 100 is refused');
select throws_like($$select pg_temp.claim('w1', 1, 5)$$, 'invalid_lease_seconds%',
  'lease below 10 s is refused');
select throws_like($$select pg_temp.claim('w1', 1, 3601)$$, 'invalid_lease_seconds%',
  'lease above 3600 s is refused');
select throws_like($$select pg_temp.ext('w1', '{g1}', 5)$$, 'invalid_lease_seconds%',
  'extend: lease below 10 s is refused');
select throws_like($$select pg_temp.reap(0, 500)$$, 'invalid_max_attempts%',
  'reap: max attempts below 1 is refused');
select throws_like($$select pg_temp.reap(3, 0)$$, 'invalid_limit%',
  'reap: limit below 1 is refused');

-- ---------------------------------------------------------------------
-- D. Extend leases
-- ---------------------------------------------------------------------
select is(pg_temp.ext('w2', '{g2,s1,g1}', 300), 'g2,s1',
  'only rows this worker holds are extended (g1 belongs to w1)');
select is(
  (select lease_expires_at - now() from public.opportunities where original_url = 'g2'),
  interval '300 seconds', 'extended lease is now + new lease_seconds');
select is(
  (select lease_expires_at - now() from public.opportunities where original_url = 'g1'),
  interval '120 seconds', 'a row held by another worker keeps its lease');

-- ---------------------------------------------------------------------
-- E. Reaper
-- ---------------------------------------------------------------------
update public.opportunities
   set lease_expires_at = now() - interval '1 second'
 where original_url in ('g1', 'q1');
update public.opportunities
   set attempts = 3, lease_expires_at = now() - interval '1 second'
 where original_url = 'sat1';
-- A running row in a paused job, as if its worker died
update public.opportunities
   set check_status = 'running', locked_by = 'wx', attempts = 1,
       lease_expires_at = now() - interval '1 second'
 where original_url = 'pa1';

select is(pg_temp.reap(3, 500), '3,1',
  'expired leases: 3 requeued, 1 failed at max attempts');
select is(pg_temp.row('g1'), 'pending|-|1|-|nolease',
  'requeued row is pending, no owner, attempts kept');
select is(pg_temp.row('sat1'), 'failed|-|3|max_attempts_exceeded|nolease',
  'row at max attempts fails with a reason, row kept (I3)');
select is(pg_temp.row('pa1'), 'pending|-|1|-|nolease',
  'reaper also frees rows of a paused job');
select is(pg_temp.row('g2'), 'running|w2|1|-|lease', 'a live lease is not reaped');
select is(pg_temp.reap(3, 500), '0,0', 'reaping again does nothing');

update public.opportunities
   set lease_expires_at = now() - interval '1 second'
 where original_url in ('g2', 's1');
select is(pg_temp.reap(3, 1), '1,0', 'p_limit caps the rows per call');
select is(pg_temp.reap(3, 500), '1,0', 'the next call takes the rest');

-- ---------------------------------------------------------------------
-- F. Lost claims and attempts
-- ---------------------------------------------------------------------
select is(pg_temp.ext('w2', '{g2}', 120), '',
  'a worker whose row was reaped gets nothing back from extend');
select is(pg_temp.claim('w6', 10, 120), 'g1,g2,q1,s1',
  're-claim after reap (pa1 stays: its job is paused)');
select is(pg_temp.row('g1'), 'running|w6|2|-|lease',
  'attempts counts every claim, crashes included');
select is(pg_temp.ext('w2', '{g2}', 120), '',
  'the old owner cannot extend a row now held by another worker');
select is(pg_temp.ext('w6', '{g1,g2}', 120), 'g1,g2', 'the new owner can');

-- ---------------------------------------------------------------------
-- G. Graceful release
-- ---------------------------------------------------------------------
select is(pg_temp.rel('w6'), '4', 'release returns the number of rows handed back');
select is(pg_temp.row('g1'), 'pending|-|1|-|nolease',
  'released row is pending and the attempt is given back');
select is(pg_temp.row('pp1'), 'running|w5|1|-|lease',
  'rows held by other workers are not touched');
select is(pg_temp.rel('w6'), '0', 'releasing twice is a no-op');
select is(pg_temp.claim('w7', 1, 120), 'g1', 'a released row can be claimed again');

-- ---------------------------------------------------------------------
-- H. Execute rights (I12)
-- ---------------------------------------------------------------------
select ok(
  has_function_privilege('worker', 'public.claim_opportunity_checks(text,integer,integer)', 'execute')
  and has_function_privilege('worker', 'public.extend_opportunity_leases(text,uuid[],integer)', 'execute')
  and has_function_privilege('worker', 'public.release_opportunity_claims(text)', 'execute')
  and has_function_privilege('worker', 'public.reap_expired_leases(integer,integer)', 'execute'),
  'worker can execute all four engine functions');
select is(
  (select count(*)::int
   from (values ('anon'), ('authenticated'), ('service_role')) r(name)
   cross join (values
     ('public.claim_opportunity_checks(text,integer,integer)'),
     ('public.extend_opportunity_leases(text,uuid[],integer)'),
     ('public.release_opportunity_claims(text)'),
     ('public.reap_expired_leases(integer,integer)')
   ) f(sig)
   where has_function_privilege(r.name, f.sig, 'execute')),
  0, 'no browser-facing role can execute any of them');
select throws_like(
  $$select pg_temp.as_role('authenticated',
      $q$select count(*)::text from public.claim_opportunity_checks('w', 1, 120)$q$)$$,
  'permission denied for function claim_opportunity_checks%',
  'a signed-in user cannot claim work');

select * from finish();
rollback;