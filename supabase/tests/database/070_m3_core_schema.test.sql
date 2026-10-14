begin;
select plan(83);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres)
-- a1 admin, a2 manager (results.view_filtered, no system.view_health),
-- a3 viewer (results.view only)
-- Jobs: A (main), B (same URLs as A), C (deleted to test cascade),
--       D (deleted to test heartbeat set null)
-- Opportunities in job A: o1 ready, o2 auto-filtered, o3 pending
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

insert into public.jobs (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'M3 job A'),
  ('10000000-0000-0000-0000-00000000000b', 'M3 job B'),
  ('10000000-0000-0000-0000-00000000000c', 'M3 job C'),
  ('10000000-0000-0000-0000-00000000000d', 'M3 job D');

create function pg_temp.mk_opp(
  p_id uuid,
  p_job uuid,
  p_path text,
  p_group public.opportunity_queue_group default null,
  p_reason text default null,
  p_score numeric default null
) returns uuid
language sql
as $$
  insert into public.opportunities
    (id, job_id, original_url, normalized_url, host, domain,
     first_source_type, config_version, queue_group, filter_reason, score)
  values
    (p_id, p_job, 'https://example.com/' || p_path, 'https://example.com/' || p_path,
     'example.com', 'example.com', 'competitor_csv', 1, p_group, p_reason, p_score)
  returning id
$$;

create function pg_temp.plan_text(q text) returns text
language plpgsql
as $$
declare
  r text;
  t text := '';
begin
  for r in execute 'explain ' || q loop
    t := t || r || E'\n';
  end loop;
  return t;
end;
$$;

select pg_temp.mk_opp('20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-00000000000a', 'ready', 'ready', null, 80);
select pg_temp.mk_opp('20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-00000000000a', 'filtered', 'auto_filtered', 'dead_page', null);
select pg_temp.mk_opp('20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-00000000000a', 'pending');

insert into public.opportunity_sources (opportunity_id, source_type, source_ref) values
  ('20000000-0000-0000-0000-000000000001', 'competitor_csv', 'rival-a'),
  ('20000000-0000-0000-0000-000000000002', 'google', 'q-1');

insert into public.domains (registered_domain) values ('example.com');
insert into public.job_domains (job_id, registered_domain, first_source_type)
  values ('10000000-0000-0000-0000-00000000000a', 'example.com', 'competitor_csv');
insert into public.worker_heartbeats (worker_id, host, current_job_id)
  values ('test-worker', 'host-1', '10000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------
-- A. opportunities: constraints and defaults
-- ---------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.mk_opp(gen_random_uuid(), '10000000-0000-0000-0000-00000000000b', 'ready')$$,
  'the same URL can exist in another job (I7)'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/ready',
            'example.com', 'example.com', 'google', 1)$$,
  '%opportunities_job_url_key%',
  'the same normalized URL twice in one job is rejected (I7)'
);
select is(
  (select concat_ws(',', check_status, priority, overlap_count, client_link_status,
                    found_by_count, flags)
     from public.opportunities where id = '20000000-0000-0000-0000-000000000003'),
  'pending,2,0,unknown,1,{}',
  'a new opportunity starts pending, search priority, no overlap, client link unknown'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'http://example.com/x3',
            'example.com', 'example.com', 'google', 1)$$,
  '%opportunities_normalized_url_https%',
  'normalized URL must be https'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x4',
            'localhost', 'localhost', 'google', 1)$$,
  '%opportunities_domain_format%',
  'domain must look like a registered domain'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x5',
            'example.com', 'example.com', 'bing', 1)$$,
  '%opportunities_first_source_type_check%',
  'only known source types are accepted'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, score)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x6',
            'example.com', 'example.com', 'google', 1, 101)$$,
  '%opportunities_score_range%',
  'score above 100 is rejected'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, tier)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x7',
            'example.com', 'example.com', 'google', 1, 'epic')$$,
  '%invalid input value for enum%',
  'an unknown tier is rejected'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, attempts)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x8',
            'example.com', 'example.com', 'google', 1, -1)$$,
  '%opportunities_attempts_range%',
  'negative attempts are rejected'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, check_status)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x9',
            'example.com', 'example.com', 'google', 1, 'running')$$,
  '%opportunities_running_has_lease%',
  'a running row must have an owner and a lease'
);
select lives_ok(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version,
       check_status, locked_by, lease_expires_at)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x10',
            'example.com', 'example.com', 'google', 1,
            'running', 'worker-1', now() + interval '2 minutes')$$,
  'a running row with owner and lease is accepted'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, queue_group)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x11',
            'example.com', 'example.com', 'google', 1, 'auto_filtered')$$,
  '%opportunities_filtered_has_reason%',
  'an auto-filtered row must say why (I3)'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, check_status)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x12',
            'example.com', 'example.com', 'google', 1, 'skipped')$$,
  '%opportunities_skipped_has_reason%',
  'a skipped row must say why (I3)'
);
select lives_ok(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version,
       check_status, check_reason, queue_group, tier)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x13',
            'example.com', 'example.com', 'google', 1,
            'skipped', 'domain_cap', 'backlog', 'unchecked')$$,
  'a domain-capped row is stored as skipped, unchecked, in the backlog'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version,
       queue_group, filter_reason)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x14',
            'example.com', 'example.com', 'google', 1, 'ready', 'dead_page')$$,
  '%opportunities_filter_reason_group%',
  'only auto-filtered rows carry a filter reason'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version, flags)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x15',
            'example.com', 'example.com', 'google', 1, '[]'::jsonb)$$,
  '%opportunities_flags_object%',
  'flags must be a JSON object'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version,
       client_link_status)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/x16',
            'example.com', 'example.com', 'google', 1, 'bogus')$$,
  '%opportunities_client_link_status_check%',
  'client link status must be unknown or known_partial'
);
select throws_like(
  $$update public.opportunities set duplicate_of = id
      where id = '20000000-0000-0000-0000-000000000003'$$,
  '%opportunities_duplicate_not_self%',
  'a row cannot be a duplicate of itself'
);
select lives_ok(
  $$select pg_temp.mk_opp('20000000-0000-0000-0000-0000000000d1',
      '10000000-0000-0000-0000-00000000000a', 'dup-target');
    select pg_temp.mk_opp('20000000-0000-0000-0000-0000000000d2',
      '10000000-0000-0000-0000-00000000000a', 'dup-child');
    update public.opportunities set duplicate_of = '20000000-0000-0000-0000-0000000000d1'
      where id = '20000000-0000-0000-0000-0000000000d2';
    delete from public.opportunities where id = '20000000-0000-0000-0000-0000000000d1'$$,
  'a merge target can be deleted'
);
select ok(
  (select duplicate_of is null from public.opportunities
     where id = '20000000-0000-0000-0000-0000000000d2'),
  'deleting a merge target clears duplicate_of on the other row'
);

-- ---------------------------------------------------------------------
-- B. opportunity_sources
-- ---------------------------------------------------------------------
select lives_ok(
  $$insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values ('20000000-0000-0000-0000-000000000001', 'google', 'q-2')$$,
  'a second source can be added to one opportunity'
);
select throws_like(
  $$insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values ('20000000-0000-0000-0000-000000000001', 'google', 'q-2')$$,
  '%opportunity_sources_pkey%',
  'the same source twice is rejected'
);
select throws_like(
  $$insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values ('20000000-0000-0000-0000-000000000001', 'bing', 'q-3')$$,
  '%opportunity_sources_source_type_check%',
  'only known source types are accepted'
);
select throws_like(
  $$insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values ('20000000-0000-0000-0000-000000000001', 'google', '  ')$$,
  '%opportunity_sources_ref_not_blank%',
  'a blank source reference is rejected'
);
select lives_ok(
  $$select pg_temp.mk_opp('20000000-0000-0000-0000-0000000000c1',
      '10000000-0000-0000-0000-00000000000c', 'c');
    insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
      values ('20000000-0000-0000-0000-0000000000c1', 'seed_list', 'seed');
    delete from public.jobs where id = '10000000-0000-0000-0000-00000000000c'$$,
  'a job with opportunities and sources can be deleted'
);

-- ---------------------------------------------------------------------
-- C. cascade, domains, job_domains
-- ---------------------------------------------------------------------
select is(
  (select count(*) from public.opportunities
     where job_id = '10000000-0000-0000-0000-00000000000c')
  + (select count(*) from public.opportunity_sources
       where opportunity_id = '20000000-0000-0000-0000-0000000000c1'),
  0::bigint,
  'deleting a job removes its opportunities and sources'
);
select throws_like(
  $$insert into public.domains (registered_domain) values ('example.com')$$,
  '%domains_pkey%',
  'a registered domain is cached once'
);
select throws_like(
  $$insert into public.domains (registered_domain) values ('Not A Domain')$$,
  '%domains_registered_domain_format%',
  'a bad domain shape is rejected'
);
select throws_like(
  $$insert into public.domains (registered_domain, global_spam) values ('spam.com', true)$$,
  '%domains_spam_has_time%',
  'a global spam flag needs a time'
);
select lives_ok(
  $$insert into public.domains (registered_domain, global_spam, global_spam_at)
    values ('spam.com', true, now())$$,
  'a global spam flag with a time is accepted'
);
select throws_like(
  $$insert into public.domains (registered_domain, tld_flags) values ('x1.com', '[]'::jsonb)$$,
  '%domains_tld_flags_object%',
  'tld flags must be a JSON object'
);
select throws_like(
  $$insert into public.domains (registered_domain, robots_txt)
    values ('big.com', repeat('a', 524289))$$,
  '%domains_robots_size%',
  'robots.txt is capped at 512 KiB (G19)'
);
select throws_like(
  $$insert into public.job_domains (job_id, registered_domain, first_source_type)
    values ('10000000-0000-0000-0000-00000000000a', 'example.com', 'google')$$,
  '%job_domains_pkey%',
  'a domain is "new" in a job only once (G11)'
);
select throws_like(
  $$insert into public.job_domains (job_id, registered_domain, first_source_type)
    values ('10000000-0000-0000-0000-00000000000b', 'example.com', 'bing')$$,
  '%job_domains_first_source_type_check%',
  'only known source types are accepted for seen domains'
);
select lives_ok(
  $$insert into public.job_domains (job_id, registered_domain, first_source_type)
    values ('10000000-0000-0000-0000-00000000000b', 'example.com', 'google')$$,
  'the same domain can be new in another job'
);

-- ---------------------------------------------------------------------
-- D. job_stats and worker_heartbeats
-- ---------------------------------------------------------------------
select is(
  (select count(*) from public.job_stats
     where job_id in ('10000000-0000-0000-0000-00000000000a',
                      '10000000-0000-0000-0000-00000000000b')),
  2::bigint,
  'creating a job creates its counters row'
);
select is(
  (select concat_ws(',', credits_used, queries_total, queries_done, unique_opportunities,
                    duplicates_skipped, unchecked_count)
     from public.job_stats where job_id = '10000000-0000-0000-0000-00000000000a'),
  '0,0,0,0,0,0',
  'counters start at zero'
);
select is(
  (select count(*) from public.jobs j
     where not exists (select 1 from public.job_stats s where s.job_id = j.id)),
  0::bigint,
  'every job has a counters row'
);
select throws_like(
  $$update public.job_stats set duplicates_skipped = -1
      where job_id = '10000000-0000-0000-0000-00000000000a'$$,
  '%job_stats_counters_nonneg%',
  'counters cannot go negative'
);
select throws_like(
  $$insert into public.worker_heartbeats (worker_id, host) values ('  ', 'h')$$,
  '%worker_heartbeats_worker_id_not_blank%',
  'a heartbeat needs a worker id'
);
select lives_ok(
  $$insert into public.worker_heartbeats (worker_id, host, current_job_id)
    values ('hb-d', 'host-2', '10000000-0000-0000-0000-00000000000d');
    delete from public.jobs where id = '10000000-0000-0000-0000-00000000000d'$$,
  'a job can be deleted while a worker points at it'
);
select ok(
  (select current_job_id is null from public.worker_heartbeats where worker_id = 'hb-d'),
  'the heartbeat then points at no job'
);
select ok(
  (select count(*) = 1 from public.worker_heartbeats where worker_id = 'test-worker'),
  'the fixture heartbeat is stored'
);

-- ---------------------------------------------------------------------
-- E. indexes are usable. Sequential and bitmap scans are switched off so
-- the planner must show whether an index can serve the query.
-- ---------------------------------------------------------------------
set local enable_seqscan = off;
set local enable_bitmapscan = off;

select ok(
  pg_temp.plan_text($$select id from public.opportunities
      where check_status = 'pending' order by priority, created_at, id limit 10$$)
    like '%opportunities_claim_idx%',
  'the claim query uses the partial claim index'
);
select ok(
  pg_temp.plan_text($$select id from public.opportunities
      where check_status = 'running' and lease_expires_at < now()$$)
    like '%opportunities_lease_idx%',
  'the reaper query uses the lease index'
);
select ok(
  pg_temp.plan_text($$select id from public.opportunities
      where job_id = '10000000-0000-0000-0000-00000000000a' and queue_group = 'ready'
      order by score desc nulls last, overlap_count desc, created_at, id limit 50$$)
    like '%opportunities_ranking_idx%',
  'the review queue query uses the ranking index'
);
select ok(
  pg_temp.plan_text($$select id from public.opportunities
      where job_id = '10000000-0000-0000-0000-00000000000a' and domain = 'example.com'$$)
    like '%opportunities_job_domain_idx%',
  'the per-domain query uses the job and domain index'
);

reset enable_seqscan;
reset enable_bitmapscan;

-- ---------------------------------------------------------------------
-- F. privileges
-- ---------------------------------------------------------------------
select ok(
  not exists (
    select 1
    from unnest(array['opportunities', 'opportunity_sources', 'domains', 'job_domains',
                      'job_stats', 'worker_heartbeats']) as t
    cross join unnest(array['select', 'insert', 'update', 'delete']) as p
    where has_table_privilege('anon', 'public.' || t, p)
  ),
  'anon has no privilege on any M3 table'
);
select ok(
  not exists (
    select 1
    from unnest(array['opportunities', 'opportunity_sources', 'domains', 'job_domains',
                      'job_stats', 'worker_heartbeats']) as t
    cross join unnest(array['insert', 'update', 'delete', 'truncate']) as p
    where has_table_privilege('authenticated', 'public.' || t, p)
  ),
  'signed-in users cannot write any M3 table'
);
select ok(
  not exists (
    select 1
    from unnest(array['opportunities', 'opportunity_sources', 'domains', 'job_domains',
                      'job_stats', 'worker_heartbeats']) as t
    where not has_table_privilege('authenticated', 'public.' || t, 'select')
  ),
  'signed-in users can read every M3 table (RLS decides the rows)'
);
select ok(
  not exists (
    select 1
    from unnest(array['opportunities', 'opportunity_sources', 'domains', 'job_domains',
                      'job_stats', 'worker_heartbeats']) as t
    where not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)
  ),
  'row level security is on for every M3 table'
);
select ok(
  has_table_privilege('worker', 'public.opportunities', 'insert')
  and has_table_privilege('worker', 'public.opportunities', 'update')
  and not has_table_privilege('worker', 'public.opportunities', 'delete'),
  'the worker can insert and update opportunities but not delete them'
);

-- ---------------------------------------------------------------------
-- G. row level security for people
-- ---------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is(
  (select count(*) from public.opportunities
     where id in ('20000000-0000-0000-0000-000000000001',
                  '20000000-0000-0000-0000-000000000002',
                  '20000000-0000-0000-0000-000000000003')),
  2::bigint,
  'viewer sees the ready and pending rows'
);
select is(
  (select count(*) from public.opportunities
     where id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'viewer does not see the auto-filtered row'
);
select is(
  (select count(*) from public.opportunity_sources
     where opportunity_id in ('20000000-0000-0000-0000-000000000001',
                              '20000000-0000-0000-0000-000000000002')),
  2::bigint,
  'viewer sees the sources of visible rows only'
);
select is(
  (select count(*) from public.job_stats
     where job_id = '10000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'viewer sees job counters'
);
select is(
  (select count(*) from public.domains where registered_domain = 'example.com')
  + (select count(*) from public.job_domains
       where job_id = '10000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'viewer sees cached domains and seen domains'
);
select is(
  (select count(*) from public.worker_heartbeats),
  0::bigint,
  'viewer cannot see worker heartbeats'
);
select throws_like(
  $$insert into public.opportunities
      (job_id, original_url, normalized_url, host, domain, first_source_type, config_version)
    values ('10000000-0000-0000-0000-00000000000a', 'u', 'https://example.com/v1',
            'example.com', 'example.com', 'google', 1)$$,
  '%permission denied for table opportunities%',
  'viewer cannot insert opportunities'
);
select throws_like(
  $$update public.opportunities set score = 1
      where id = '20000000-0000-0000-0000-000000000001'$$,
  '%permission denied for table opportunities%',
  'viewer cannot update opportunities'
);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select is(
  (select count(*) from public.opportunities
     where id in ('20000000-0000-0000-0000-000000000001',
                  '20000000-0000-0000-0000-000000000002',
                  '20000000-0000-0000-0000-000000000003')),
  3::bigint,
  'manager also sees the auto-filtered row'
);
select is(
  (select count(*) from public.opportunity_sources
     where opportunity_id in ('20000000-0000-0000-0000-000000000001',
                              '20000000-0000-0000-0000-000000000002')),
  3::bigint,
  'manager sees the sources of filtered rows too'
);
select is(
  (select count(*) from public.worker_heartbeats),
  0::bigint,
  'manager cannot see worker heartbeats without system.view_health'
);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is(
  (select count(*) from public.worker_heartbeats where worker_id = 'test-worker'),
  1::bigint,
  'admin sees worker heartbeats'
);

select set_config('request.jwt.claims', '', true);
select is(
  (select count(*) from public.opportunities) + (select count(*) from public.job_stats),
  0::bigint,
  'a request with no session sees nothing'
);
select throws_like(
  $$delete from public.opportunities where id = '20000000-0000-0000-0000-000000000001'$$,
  '%permission denied for table opportunities%',
  'nobody signed in can delete opportunities'
);

-- ---------------------------------------------------------------------
-- H. the worker role
-- ---------------------------------------------------------------------
reset role;
grant usage on schema extensions to worker;  -- so pgTAP functions resolve; rolled back with the test
set local role worker;

select lives_ok(
  $$insert into public.opportunities
      (id, job_id, original_url, normalized_url, host, domain, first_source_type,
       config_version, priority)
    values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a',
            'https://example.com/w1', 'https://example.com/w1', 'example.com', 'example.com',
            'seed_list', 1, 1)$$,
  'worker can insert an opportunity'
);
select lives_ok(
  $$update public.opportunities set check_status = 'done'
      where id = '20000000-0000-0000-0000-0000000000f1'$$,
  'worker can update an opportunity'
);
select lives_ok(
  $$insert into public.opportunity_sources (opportunity_id, source_type, source_ref)
    values ('20000000-0000-0000-0000-0000000000f1', 'seed_list', 'seed')$$,
  'worker can record a source'
);
select lives_ok(
  $$insert into public.domains (registered_domain) values ('worker-new.com');
    update public.domains set blocked_suspected = true, blocked_suspected_at = now()
      where registered_domain = 'worker-new.com'$$,
  'worker can cache and update a domain'
);
select lives_ok(
  $$insert into public.job_domains (job_id, registered_domain, first_source_type)
    values ('10000000-0000-0000-0000-00000000000a', 'worker-new.com', 'seed_list')$$,
  'worker can record a seen domain'
);
select lives_ok(
  $$update public.job_stats set unique_opportunities = unique_opportunities + 1
      where job_id = '10000000-0000-0000-0000-00000000000a'$$,
  'worker can update counters'
);
select lives_ok(
  $$update public.worker_heartbeats set last_seen_at = now() where worker_id = 'test-worker';
    insert into public.worker_heartbeats (worker_id, host) values ('w-new', 'host-3')$$,
  'worker can write heartbeats'
);
select lives_ok(
  $$insert into public.job_events (job_id, type)
    values ('10000000-0000-0000-0000-00000000000a', 'worker_test')$$,
  'worker can append to the job activity log'
);
select ok(
  (select count(*) from public.jobs where id = '10000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.opportunities
         where id in ('20000000-0000-0000-0000-000000000001',
                      '20000000-0000-0000-0000-000000000002',
                      '20000000-0000-0000-0000-000000000003')) = 3,
  'worker reads jobs and every opportunity group'
);
select throws_like(
  $$delete from public.opportunities where id = '20000000-0000-0000-0000-0000000000f1'$$,
  '%permission denied for table opportunities%',
  'worker cannot delete opportunities'
);
select throws_like(
  $$update public.jobs set name = 'renamed' where id = '10000000-0000-0000-0000-00000000000a'$$,
  '%permission denied for table jobs%',
  'worker cannot edit jobs directly'
);
select throws_like(
  $$insert into public.blocklist (domain) values ('worker-added.com')$$,
  '%permission denied for table blocklist%',
  'worker cannot edit the blocklist'
);
select throws_like(
  $$select count(*) from public.profiles$$,
  '%permission denied for table profiles%',
  'worker cannot read user profiles'
);
select throws_like(
  $$select count(*) from public.roles$$,
  '%permission denied for table roles%',
  'worker cannot read roles'
);
select ok(
  has_function_privilege('worker', 'public.worker_transition_job(uuid,text,text)', 'execute'),
  'worker can call worker_transition_job'
);
select ok(
  not has_function_privilege('worker', 'public.transition_job(uuid,text,text)', 'execute'),
  'worker cannot call the user action transition_job'
);
select ok(
  not has_function_privilege('anon', 'public.worker_transition_job(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.worker_transition_job(uuid,text,text)', 'execute'),
  'nobody else gained access to worker_transition_job'
);

reset role;
select * from finish();
rollback;