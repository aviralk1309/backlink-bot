begin;
select plan(70);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
-- Jobs: J1 main, J2 same URLs as J1, J3 config_version 3, J4 merge scenarios
--
-- Every call to the functions under test runs as the `worker` role through
-- pg_temp.as_role(). The pgTAP assertions themselves run as postgres, so the
-- worker role needs no access to the pgTAP schema.
-- ---------------------------------------------------------------------
insert into public.jobs (id, name) values
  ('30000000-0000-0000-0000-000000000001', 'M3 S4 job 1'),
  ('30000000-0000-0000-0000-000000000002', 'M3 S4 job 2'),
  ('30000000-0000-0000-0000-000000000003', 'M3 S4 job 3'),
  ('30000000-0000-0000-0000-000000000004', 'M3 S4 job 4');
update public.jobs set config_version = 3
  where id = '30000000-0000-0000-0000-000000000003';

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

-- record_discovery as worker. Returns 'created,source_added,domain_added' as t or f.
create function pg_temp.rd(
  p_job uuid, p_dom text, p_path text, p_type text, p_ref text,
  p_extras jsonb default '{}'::jsonb
) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select concat_ws(',', created, source_added, domain_added)
         from public.record_discovery(%L, %L, %L, %L, %L, %L, %L, %L::jsonb)$q$,
    p_job,
    'http://ORIG.' || p_dom || '/' || p_path,
    'https://' || p_dom || '/' || p_path,
    p_dom, p_dom, p_type, p_ref, p_extras::text))
$$;

-- id of the opportunity for a URL in a job
create function pg_temp.oid(p_job uuid, p_dom text, p_path text) returns uuid
language sql
as $$
  select id from public.opportunities
  where job_id = p_job and normalized_url = 'https://' || p_dom || '/' || p_path
$$;

-- merge_opportunity_after_fetch as worker. Returns 'outcome,canonical_id'.
create function pg_temp.mg(p_opp uuid, p_final text) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select concat_ws(',', outcome, canonical_id)
         from public.merge_opportunity_after_fetch(%L, %L)$q$,
    p_opp, p_final))
$$;

create function pg_temp.stats(p_job uuid) returns text
language sql
as $$
  select unique_opportunities || ',' || duplicates_skipped
  from public.job_stats where job_id = p_job
$$;

-- ---------------------------------------------------------------------
-- A. record_discovery: new rows, replays, extra sources
-- ---------------------------------------------------------------------
select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1',
    'competitor_csv', 'rival-a', '{"a":1}'),
  't,t,t',
  'first discovery: new row, new source, new domain'
);
select is(
  (select concat_ws('|', normalized_url, original_url, host, domain, first_source_type,
          priority, config_version, found_by_count, check_status)
   from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1')),
  'https://alpha.com/p1|http://ORIG.alpha.com/p1|alpha.com|alpha.com|competitor_csv|0|1|1|pending',
  'row carries the worker values, priority 0 for a competitor CSV, pending'
);
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '1,0',
  'counters: 1 unique, 0 duplicates');
select is(
  (select count(*)::int from public.job_domains
   where job_id = '30000000-0000-0000-0000-000000000001'),
  1, 'job_domains has the domain once');

select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1',
    'competitor_csv', 'rival-a'),
  'f,f,f',
  'replaying the same discovery is a no-op'
);
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '1,0',
  'replay does not move the counters');

select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1',
    'google', 'q1', '{"a":2,"b":3}'),
  'f,t,f',
  'same URL from another source: no new row, new source'
);
select is(
  (select found_by_count from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1')),
  2, 'found_by_count counts both sources');
select is(
  (select count(*)::int from public.opportunity_sources
   where opportunity_id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1')),
  2, 'both sources are stored');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '1,1',
  'counters: 1 unique, 1 duplicate');
select is(
  (select extras from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1')),
  '{"a":1,"b":3}'::jsonb,
  'extras: existing keys win, new keys are added');
select is(
  (select priority from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p1')),
  0::smallint, 'a later google source does not raise the priority number');

select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p2', 'google', 'q1'),
  't,t,f',
  'second URL on a known domain: new row, domain not new'
);
select is(
  (select priority from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p2')),
  2::smallint, 'google priority is 2');
select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p2',
    'competitor_csv', 'rival-a'),
  'f,t,f',
  'gap source on a search row is added'
);
select is(
  (select priority from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'alpha.com', 'p2')),
  0::smallint, 'priority drops to the lowest number: gap first (I6)');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '2,2',
  'counters after two rows and two extra sources');

select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000001', 'beta.com', 's1', 'seed_list', 'list-1'),
  't,t,t',
  'seed list row on a new domain'
);
select is(
  (select priority from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000001', 'beta.com', 's1')),
  1::smallint, 'seed list priority is 1');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '3,2', 'counters: 3 unique, 2 duplicates');

select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000002', 'alpha.com', 'p1', 'google', 'q1'),
  't,t,t',
  'same URL in another job is a new row and a new domain for that job (I7, G11)'
);
select is(pg_temp.stats('30000000-0000-0000-0000-000000000002'), '1,0', 'job 2 counters are its own');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '3,2', 'job 1 counters unchanged');

select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000003', 'alpha.com', 'p1', 'google', 'q1'),
  't,t,t', 'job 3 discovery'
);
select is(
  (select config_version from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000003', 'alpha.com', 'p1')),
  3, 'config_version is copied from the job (A5)');

-- ---------------------------------------------------------------------
-- B. record_discovery: errors and atomicity
-- ---------------------------------------------------------------------
select throws_like(
  $$select pg_temp.rd('30000000-0000-0000-0000-000000000001', 'x.com', 'p', 'bing', 'q')$$,
  'unknown source type%', 'unknown source type is refused');
select throws_like(
  $$select pg_temp.rd('30000000-0000-0000-0000-0000000000ff', 'x.com', 'p', 'google', 'q')$$,
  'job not found%', 'unknown job is refused');
select throws_like(
  $$select pg_temp.rd('30000000-0000-0000-0000-000000000001', 'x.com', 'p', 'google', 'q', '[1]'::jsonb)$$,
  'extras must be a JSON object%', 'non-object extras are refused');
select throws_like(
  $$select pg_temp.as_role('worker', $q$select created::text from public.record_discovery(
      '30000000-0000-0000-0000-000000000001', 'http://x.com/', 'http://x.com/',
      'x.com', 'x.com', 'google', 'q', '{}')$q$)$$,
  '%opportunities_normalized_url_https%', 'a non-https normalized URL is refused by the table');

select throws_like(
  $$select pg_temp.rd('30000000-0000-0000-0000-000000000001', 'gamma.com', 'p', 'google', ' ')$$,
  '%opportunity_sources_ref_not_blank%', 'a blank source ref is refused');
select is(
  (select count(*)::int from public.opportunities where domain = 'gamma.com'),
  0, 'atomic: the failed call left no opportunity behind');
select is(
  (select count(*)::int from public.job_domains where registered_domain = 'gamma.com'),
  0, 'atomic: and no job_domains row');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000001'), '3,2',
  'atomic: and no counter change');

-- ---------------------------------------------------------------------
-- C. Execute rights
-- ---------------------------------------------------------------------
select ok(
  has_function_privilege('worker',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and has_function_privilege('worker',
    'public.merge_opportunity_after_fetch(uuid,text)', 'execute'),
  'worker can execute both functions');
select ok(
  not has_function_privilege('anon',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('service_role',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('anon',
    'public.merge_opportunity_after_fetch(uuid,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.merge_opportunity_after_fetch(uuid,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.merge_opportunity_after_fetch(uuid,text)', 'execute'),
  'no browser-facing role can execute them (I12)');
select throws_like(
  $$select pg_temp.as_role('authenticated', $q$select created::text from public.record_discovery(
      '30000000-0000-0000-0000-000000000001', 'https://x.com/', 'https://x.com/',
      'x.com', 'x.com', 'google', 'q', '{}')$q$)$$,
  'permission denied for function record_discovery%', 'a signed-in user cannot call record_discovery');

-- ---------------------------------------------------------------------
-- D. merge_opportunity_after_fetch (job 4)
-- ---------------------------------------------------------------------
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'a', 'google', 'q1');
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'b', 'competitor_csv', 'rival-a');
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'b', 'google', 'q2');
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'c', 'seed_list', 'list-1');
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'd', 'google', 'q3');

select is(pg_temp.stats('30000000-0000-0000-0000-000000000004'), '4,1', 'merge setup counters');

select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a'),
    'https://merge.com/a'),
  'unchanged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a'),
  'final URL equals the stored URL: unchanged');
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a'),
    'https://merge.com/zzz'),
  'unchanged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a'),
  'no row for the final URL: unchanged');
select is(
  (select normalized_url || '|' || check_status
   from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a')),
  'https://merge.com/a|pending',
  'the stored URL is never rewritten (I8)');

select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a'),
    'https://merge.com/b'),
  'merged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
  'a merges into b');
select is(
  (select concat_ws('|', duplicate_of = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
          check_status, check_reason, locked_by is null, lease_expires_at is null)
   from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a')),
  't|skipped|duplicate_of_final_url|t|t',
  'a is skipped with a reason and points at b; row kept (I3)');
select is(
  (select found_by_count from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b')),
  3, 'b has the sources of both rows');
select is(
  (select count(*)::int from public.opportunity_sources
   where opportunity_id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a')),
  1, 'a keeps its own source record (I3)');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000004'), '3,2',
  'merge: one fewer unique, one more duplicate');
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a'),
    'https://merge.com/b'),
  'already_merged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
  'merging again is a no-op');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000004'), '3,2',
  'and does not double count');

-- A later discovery of the merged URL lands on the canonical row
select is(
  pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'a', 'seed_list', 'list-9'),
  'f,t,f',
  'discovering a merged URL adds a source and creates no row');
select is(
  (select found_by_count from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b')),
  4, 'the source went to the canonical row b');
select is(
  (select found_by_count from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'a')),
  1, 'and not to the merged row a');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000004'), '3,3', 'counted as a duplicate');

-- Chain: c's final URL is a, which is already merged into b. Target is b.
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'c'),
    'https://merge.com/a'),
  'merged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
  'merge follows a merged row to its canonical row, no chains');
select is(
  (select duplicate_of from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'c')),
  pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
  'c points at b, not at a');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000004'), '2,4', 'chain merge counters');

-- Reverse: b's final URL is a, and a is merged into b. b stays canonical.
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
    'https://merge.com/a'),
  'unchanged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
  'a loop is refused: the canonical row stays canonical');
select is(
  (select duplicate_of is null from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b')),
  true, 'b still has no duplicate_of');

-- Re-point: b (with a and c merged into it) merges into d
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'b'),
    'https://merge.com/d'),
  'merged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'd'),
  'b merges into d');
select is(
  (select count(*)::int from public.opportunities
   where job_id = '30000000-0000-0000-0000-000000000004'
     and duplicate_of = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'd')),
  3, 'a, b and c all point at d');
select is(
  (select found_by_count || '|' || priority from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'd')),
  '6|0',
  'd has every source and the lowest priority number');
select is(pg_temp.stats('30000000-0000-0000-0000-000000000004'), '1,5', 'counters after re-point');

-- Not mergeable once past pending/running
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'e', 'google', 'q9');
update public.opportunities set check_status = 'done'
  where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'e');
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'e'),
    'https://merge.com/d'),
  'not_mergeable,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'e'),
  'a row that is already done is left alone');

-- Running row: lease is released on merge
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'g', 'google', 'q10');
select pg_temp.rd('30000000-0000-0000-0000-000000000004', 'merge.com', 'h', 'google', 'q11');
update public.opportunities
  set check_status = 'running', locked_by = 'w1', lease_expires_at = now() + interval '1 minute'
  where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'g');
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'g'),
    'https://merge.com/h'),
  'merged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'h'),
  'a running row merges');
select is(
  (select concat_ws('|', check_status, locked_by is null, lease_expires_at is null)
   from public.opportunities
   where id = pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'g')),
  'skipped|t|t',
  'and releases its lease');

-- Another job's row is not a merge target
select is(
  pg_temp.mg(pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'h'),
    'https://alpha.com/p1'),
  'unchanged,' || pg_temp.oid('30000000-0000-0000-0000-000000000004', 'merge.com', 'h'),
  'a row in another job is never a merge target');

select throws_like(
  $$select pg_temp.mg('30000000-0000-0000-0000-0000000000ee', 'https://merge.com/a')$$,
  'opportunity not found%', 'unknown opportunity is refused');
select throws_like(
  $$select pg_temp.as_role('authenticated', $q$select outcome from public.merge_opportunity_after_fetch(
      '30000000-0000-0000-0000-0000000000ee', 'https://merge.com/a')$q$)$$,
  'permission denied for function merge_opportunity_after_fetch%',
  'a signed-in user cannot call merge_opportunity_after_fetch');

-- ---------------------------------------------------------------------
-- E. Invariants over the whole job (I3, I7)
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from public.opportunities
   where job_id = '30000000-0000-0000-0000-000000000004'),
  7, 'I3: all 7 discovered URLs are still stored');
select is(
  (select unique_opportunities from public.job_stats
   where job_id = '30000000-0000-0000-0000-000000000004'),
  (select count(*)::int from public.opportunities
   where job_id = '30000000-0000-0000-0000-000000000004' and duplicate_of is null),
  'unique_opportunities equals the number of canonical rows');
select is(
  (select count(*)::int from public.opportunities o
   where o.job_id = '30000000-0000-0000-0000-000000000004'
     and o.duplicate_of is not null
     and exists (select 1 from public.opportunities t
                 where t.id = o.duplicate_of and t.duplicate_of is not null)),
  0, 'no merge chains exist');
select is(
  (select count(*)::int from public.opportunities o
   where o.check_status = 'skipped' and o.check_reason is null),
  0, 'I3: every skipped row has a reason');

select * from finish();
rollback;