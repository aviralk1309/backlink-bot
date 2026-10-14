begin;
select plan(32);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
--
-- Jobs: 1 trigger tests, 2 job_stats_add, 3 job delete.
--
-- The unchecked_count trigger is a deferred constraint trigger: it fires at
-- COMMIT, and pgTAP never commits. pg_temp.flush() fires pending events and
-- defers again, so each assertion sees the counter as a commit would leave it.
-- Rows are written directly as postgres: unique_opportunities and
-- duplicates_skipped belong to record_discovery and are tested in 071.
-- ---------------------------------------------------------------------
insert into public.jobs (id, name) values
  ('60000000-0000-0000-0000-000000000001', 'M3 S8 job 1'),
  ('60000000-0000-0000-0000-000000000002', 'M3 S8 job 2'),
  ('60000000-0000-0000-0000-000000000003', 'M3 S8 job 3');

create function pg_temp.u(n int) returns uuid
language sql
as $$
  select ('60000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

create function pg_temp.flush() returns void
language plpgsql
as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

create function pg_temp.ins(
  p_job uuid, p_label text, p_status text default 'pending',
  p_tier text default null, p_group text default null
) returns void
language sql
as $$
  insert into public.opportunities (
    job_id, original_url, normalized_url, host, domain, first_source_type,
    config_version, check_status, check_reason, tier, queue_group, filter_reason
  ) values (
    p_job, p_label, 'https://example.com/' || p_label, 'example.com', 'example.com',
    'google', 1, p_status::public.opportunity_check_status,
    case when p_status in ('skipped', 'failed') then 'fixture' end,
    p_tier::public.opportunity_tier,
    p_group::public.opportunity_queue_group,
    case when p_group = 'auto_filtered' then 'fixture' end
  )
$$;

create function pg_temp.uc(p_job uuid) returns integer
language sql
as $$
  select unchecked_count from public.job_stats where job_id = p_job
$$;

create function pg_temp.drop_job(p_job uuid) returns void
language plpgsql
as $$
begin
  delete from public.jobs where id = p_job;
  perform pg_temp.flush();
end;
$$;

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

-- ---------------------------------------------------------------------
-- A. The definition of "unchecked" (G12)
-- ---------------------------------------------------------------------
select is(public.opportunity_counts_unchecked(null, null, 'skipped', null), true,
  'skipped (could not check, domain cap) is unchecked');
select is(public.opportunity_counts_unchecked(null, null, 'failed', null), true,
  'failed (retries used up) is unchecked');
select is(public.opportunity_counts_unchecked(null, 'backlog', 'done', 'unchecked'), true,
  'tier Unchecked is unchecked');
select is(public.opportunity_counts_unchecked(null, 'auto_filtered', 'skipped', null), false,
  'an auto-filtered row was removed by a rule, not left unchecked (I4)');
select is(public.opportunity_counts_unchecked(gen_random_uuid(), null, 'skipped', null), false,
  'a merged duplicate is skipped by design, not unchecked');
select is(public.opportunity_counts_unchecked(null, 'ready', 'pending', 'high'), false,
  'a pending row with a real tier is not unchecked');
select is(public.opportunity_counts_unchecked(null, null, 'done', null), false,
  'a done row with no tier is not unchecked');
select is(public.opportunity_counts_unchecked(null, null, null, null), false,
  'all-null input is not unchecked, never null');

-- ---------------------------------------------------------------------
-- B. The trigger keeps job_stats.unchecked_count exact (job 1)
-- ---------------------------------------------------------------------
select pg_temp.ins(pg_temp.u(1), 'a');
select pg_temp.ins(pg_temp.u(1), 'b');
select pg_temp.ins(pg_temp.u(1), 'c');
select pg_temp.ins(pg_temp.u(1), 'd');
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 0, 'four pending rows: none unchecked');

update public.opportunities
   set check_status = 'skipped', check_reason = 'domain_cap'
 where job_id = pg_temp.u(1) and original_url = 'a';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 1, 'row skipped: counted');

update public.opportunities
   set check_status = 'failed', check_reason = 'max_attempts_exceeded'
 where job_id = pg_temp.u(1) and original_url = 'b';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 2, 'row failed: counted');

update public.opportunities set tier = 'unchecked'
 where job_id = pg_temp.u(1) and original_url = 'c';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 3, 'tier set to Unchecked: counted');

update public.opportunities
   set queue_group = 'auto_filtered', filter_reason = 'dead_page'
 where job_id = pg_temp.u(1) and original_url = 'a';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 2, 'row auto-filtered: no longer counted');

update public.opportunities
   set duplicate_of = (select id from public.opportunities
                       where job_id = pg_temp.u(1) and original_url = 'd'),
       check_status = 'skipped', check_reason = 'duplicate_of_final_url'
 where job_id = pg_temp.u(1) and original_url = 'c';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 1, 'row merged into another: no longer counted');

update public.opportunities set check_status = 'done'
 where job_id = pg_temp.u(1) and original_url = 'd';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 1, 'a row that was never unchecked changes nothing');

delete from public.opportunities where job_id = pg_temp.u(1) and original_url = 'b';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 0, 'deleting an unchecked row uncounts it');

select pg_temp.ins(pg_temp.u(1), 'f', 'failed');
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 1, 'a row inserted already failed is counted');

-- Several changes in one transaction: only the net result counts.
select pg_temp.ins(pg_temp.u(1), 'e');
update public.opportunities
   set check_status = 'skipped', check_reason = 'domain_cap'
 where job_id = pg_temp.u(1) and original_url = 'e';
update public.opportunities
   set check_status = 'pending', check_reason = null
 where job_id = pg_temp.u(1) and original_url = 'e';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 1, 'skipped then back to pending in one go: net zero');

update public.opportunities set queue_group = null, filter_reason = null
 where job_id = pg_temp.u(1) and original_url = 'a';
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(1)), 2, 'filter removed from a skipped row: counted again');

select is(
  pg_temp.uc(pg_temp.u(1)),
  (select r.unchecked_count from public.job_stats_recount(pg_temp.u(1)) r),
  'consistency: job_stats equals a recount from raw rows');

-- ---------------------------------------------------------------------
-- C. Deleting a job with counted rows
-- ---------------------------------------------------------------------
select pg_temp.ins(pg_temp.u(3), 'x', 'skipped');
select pg_temp.ins(pg_temp.u(3), 'y', 'failed');
select pg_temp.flush();
select is(pg_temp.uc(pg_temp.u(3)), 2, 'job 3: two unchecked rows counted');
select lives_ok($$select pg_temp.drop_job(pg_temp.u(3))$$,
  'deleting a job with counted rows does not error');
select is(
  (select count(*)::int from public.job_stats where job_id = pg_temp.u(3)),
  0, 'the stats row goes with the job');

-- ---------------------------------------------------------------------
-- D. job_stats_add: the M8 entry point (job 2)
-- ---------------------------------------------------------------------
select pg_temp.as_role('worker', format(
  $q$select public.job_stats_add(%L, 5, 2, 10)::text$q$, pg_temp.u(2)));
select is(
  (select credits_used || ',' || queries_done || ',' || queries_total
   from public.job_stats where job_id = pg_temp.u(2)),
  '5,2,10', 'credits, queries done and queries total are added');

select pg_temp.as_role('worker', format(
  $q$select public.job_stats_add(%L, 3, 1)::text$q$, pg_temp.u(2)));
select is(
  (select credits_used || ',' || queries_done || ',' || queries_total
   from public.job_stats where job_id = pg_temp.u(2)),
  '8,3,10', 'a second call adds on top; omitted deltas default to 0');

select throws_like(
  $$select pg_temp.as_role('worker', format(
      $q$select public.job_stats_add(%L, -1)::text$q$, pg_temp.u(2)))$$,
  'invalid_delta%', 'negative credits are refused');
select throws_like(
  $$select pg_temp.as_role('worker', format(
      $q$select public.job_stats_add(%L, 0, -1)::text$q$, pg_temp.u(2)))$$,
  'invalid_delta%', 'negative queries done are refused');
select throws_like(
  $$select pg_temp.as_role('worker',
      $q$select public.job_stats_add('60000000-0000-0000-0000-0000000000ff', 1)::text$q$)$$,
  'job_stats row missing%', 'unknown job is refused');
select throws_like(
  $$select pg_temp.as_role('authenticated', format(
      $q$select public.job_stats_add(%L, 1)::text$q$, pg_temp.u(2)))$$,
  'permission denied for function job_stats_add%',
  'a signed-in user cannot write counters');

-- ---------------------------------------------------------------------
-- E. Recount and execute rights (I12)
-- ---------------------------------------------------------------------
select is(
  (select r.unique_opportunities from public.job_stats_recount(pg_temp.u(1)) r),
  4, 'recount: unique rows are the canonical ones (the merged row is excluded)');
select ok(
  has_function_privilege('worker', 'public.job_stats_add(uuid,integer,integer,integer)', 'execute')
  and has_function_privilege('worker', 'public.job_stats_recount(uuid)', 'execute'),
  'worker can execute the counter functions');
select is(
  (select count(*)::int
   from (values ('anon'), ('authenticated'), ('service_role')) r(name)
   cross join (values
     ('public.job_stats_add(uuid,integer,integer,integer)'),
     ('public.job_stats_recount(uuid)'),
     ('public.opportunities_track_unchecked()')
   ) f(sig)
   where has_function_privilege(r.name, f.sig, 'execute')),
  0, 'no browser-facing role can execute any counter function');

select * from finish();
rollback;