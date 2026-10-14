begin;
select plan(26);

-- ---------------------------------------------------------------------
-- Fixtures (run as postgres). Calls under test run as the worker role.
-- J1: default job. J2: skip_previously_spam_domains on.
-- J3: blocked_domains = {jobblocked.com}.
-- Domains: banned.com (blocklist), spammy.com (global_spam), both.com (both),
--          jobblocked.com (job J3), clean.com (nothing)
-- ---------------------------------------------------------------------
insert into public.jobs (id, name) values
  ('40000000-0000-0000-0000-000000000001', 'M3 S5 job 1'),
  ('40000000-0000-0000-0000-000000000002', 'M3 S5 job 2'),
  ('40000000-0000-0000-0000-000000000003', 'M3 S5 job 3');
update public.jobs set skip_previously_spam_domains = true
  where id = '40000000-0000-0000-0000-000000000002';
update public.jobs set blocked_domains = array['jobblocked.com']
  where id = '40000000-0000-0000-0000-000000000003';

insert into public.blocklist (domain) values ('banned.com'), ('both.com');
insert into public.domains (registered_domain, global_spam, global_spam_at)
  values ('spammy.com', true, now()), ('both.com', true, now());

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

-- Returns 'created,source_added,domain_added,filter_reason,previously_spam' (t/f, '-' for none)
create function pg_temp.rd(
  p_job uuid, p_dom text, p_path text, p_type text, p_ref text
) returns text
language sql
as $$
  select pg_temp.as_role('worker', format(
    $q$select concat_ws(',', created, source_added, domain_added,
                        coalesce(filter_reason, '-'), previously_spam)
         from public.record_discovery(%L, %L, %L, %L, %L, %L, %L)$q$,
    p_job, 'http://ORIG.' || p_dom || '/' || p_path, 'https://' || p_dom || '/' || p_path,
    p_dom, p_dom, p_type, p_ref))
$$;

create function pg_temp.row_of(p_job uuid, p_dom text, p_path text) returns text
language sql
as $$
  select concat_ws('|', check_status, coalesce(check_reason, '-'), coalesce(queue_group::text, '-'),
                   coalesce(filter_reason, '-'), flags::text, found_by_count)
  from public.opportunities
  where job_id = p_job and normalized_url = 'https://' || p_dom || '/' || p_path
$$;

create function pg_temp.stats(p_job uuid) returns text
language sql
as $$
  select unique_opportunities || ',' || duplicates_skipped
  from public.job_stats where job_id = p_job
$$;

-- ---------------------------------------------------------------------
-- A. Global blocklist
-- ---------------------------------------------------------------------
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'banned.com', 'p', 'google', 'q1'),
  't,t,f,blocklisted,f',
  'blocklisted domain: row stored, filtered, not a new domain');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000001', 'banned.com', 'p'),
  'skipped|blocklisted|auto_filtered|blocklisted|{}|1',
  'stored as skipped + auto_filtered with the reason on both fields (I3)');
select is(
  (select count(*)::int from public.job_domains
   where job_id = '40000000-0000-0000-0000-000000000001' and registered_domain = 'banned.com'),
  0, 'a filtered row does not enter job_domains (G11)');
select is(pg_temp.stats('40000000-0000-0000-0000-000000000001'), '1,0',
  'it still counts as a stored opportunity');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'banned.com', 'p', 'google', 'q1'),
  'f,f,f,blocklisted,f', 'replay is a no-op');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'banned.com', 'p', 'seed_list', 'list-1'),
  'f,t,f,blocklisted,f', 'another source is added to the filtered row');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000001', 'banned.com', 'p'),
  'skipped|blocklisted|auto_filtered|blocklisted|{}|2',
  'found_by_count grows, the row stays filtered');
select is(
  (select count(*)::int from public.opportunities
   where job_id = '40000000-0000-0000-0000-000000000001'
     and check_status = 'pending' and domain = 'banned.com'),
  0, 'never pending, so never claimed or fetched');

-- ---------------------------------------------------------------------
-- B. Job blocked domains
-- ---------------------------------------------------------------------
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000003', 'jobblocked.com', 'p', 'google', 'q1'),
  't,t,f,job_blocked_domain,f', 'job-level blocked domain is filtered');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000003', 'jobblocked.com', 'p'),
  'skipped|job_blocked_domain|auto_filtered|job_blocked_domain|{}|1', 'with its own reason');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'jobblocked.com', 'p', 'google', 'q1'),
  't,t,t,-,f', 'the same domain is fine in a job that did not block it');

-- ---------------------------------------------------------------------
-- C. Previously-spam flag (G9)
-- ---------------------------------------------------------------------
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'spammy.com', 'p', 'google', 'q1'),
  't,t,t,-,t', 'skip off: row is kept, flagged, and the domain counts');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000001', 'spammy.com', 'p'),
  'pending|-|-|-|{"previously_spam": true}|1', 'pending with flags.previously_spam');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'spammy.com', 'p', 'seed_list', 'list-1'),
  'f,t,f,-,t', 'an existing flagged row reports its flag');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000002', 'spammy.com', 'p', 'google', 'q1'),
  't,t,f,previously_spam,t', 'skip on: row is auto-filtered');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000002', 'spammy.com', 'p'),
  'skipped|previously_spam|auto_filtered|previously_spam|{"previously_spam": true}|1',
  'filtered with reason and the flag kept');

-- ---------------------------------------------------------------------
-- D. Precedence, clean rows, and I8
-- ---------------------------------------------------------------------
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000002', 'both.com', 'p', 'google', 'q1'),
  't,t,f,blocklisted,f', 'blocklist wins over the spam flag');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'clean.com', 'p', 'google', 'q1'),
  't,t,t,-,f', 'a clean domain is untouched');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000001', 'clean.com', 'p'),
  'pending|-|-|-|{}|1', 'clean row is pending with no flags');

-- I8: a block added later does not rewrite an existing row
insert into public.blocklist (domain) values ('clean.com');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'clean.com', 'p', 'seed_list', 'list-1'),
  'f,t,f,-,f', 'later blocklist entry: existing row keeps its decision, source still added');
select is(
  pg_temp.row_of('40000000-0000-0000-0000-000000000001', 'clean.com', 'p'),
  'pending|-|-|-|{}|2', 'row still pending (I8)');
select is(
  pg_temp.rd('40000000-0000-0000-0000-000000000001', 'clean.com', 'q', 'google', 'q1'),
  't,t,f,blocklisted,f', 'a new URL on that domain is now filtered');

-- Counters: filtered rows count as stored, extra sources as duplicates
select is(pg_temp.stats('40000000-0000-0000-0000-000000000001'), '5,3',
  'job 1 counters add up');

-- Merge ignores filtered rows (they are skipped)
select is(
  pg_temp.as_role('worker', $q$select outcome from public.merge_opportunity_after_fetch(
    (select id from public.opportunities
     where job_id = '40000000-0000-0000-0000-000000000001'
       and normalized_url = 'https://banned.com/p'), 'https://clean.com/p')$q$),
  'not_mergeable', 'a filtered row is not merged');

-- Everything stored has a reason (I3)
select is(
  (select count(*)::int from public.opportunities
   where queue_group = 'auto_filtered' and (filter_reason is null or check_reason is null)),
  0, 'every filtered row has a reason');
select ok(
  has_function_privilege('worker',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('anon',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('service_role',
    'public.record_discovery(uuid,text,text,text,text,text,text,jsonb)', 'execute'),
  'execute rights survived the replace');

select * from finish();
rollback;