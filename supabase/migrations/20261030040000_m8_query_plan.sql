-- M8-S3: expand the M7 reporting identity into a durable search queue.
alter table public.job_queries
  add column gl text,
  add column hl text,
  add column location text,
  add column num integer not null default 10,
  add column page integer not null default 1,
  add column priority integer not null default 1,
  add column status text not null default 'pending',
  add column attempts integer not null default 0,
  add column locked_by text,
  add column lease_expires_at timestamptz,
  add column credits_used integer,
  add column result_count integer,
  add column new_unique_domains integer,
  add column error text,
  add column completed_at timestamptz,
  add constraint job_queries_num_range check (num between 1 and 100),
  add constraint job_queries_page_range check (page between 1 and 10),
  add constraint job_queries_priority_positive check (priority > 0),
  add constraint job_queries_status_check check (status in ('pending','running','done','failed')),
  add constraint job_queries_attempts_nonnegative check (attempts >= 0),
  add constraint job_queries_credits_nonnegative check (credits_used is null or credits_used >= 0),
  add constraint job_queries_results_nonnegative check (result_count is null or result_count >= 0),
  add constraint job_queries_domains_nonnegative
    check (new_unique_domains is null or new_unique_domains >= 0),
  add constraint job_queries_running_has_lease
    check (status <> 'running' or (locked_by is not null and lease_expires_at is not null)),
  add constraint job_queries_text_length check (char_length(query_text) <= 1000),
  add constraint job_queries_location_length check (location is null or char_length(location) <= 100);

-- Null locations are equivalent for dedupe; identical paid requests get one row.
create unique index job_queries_request_key
  on public.job_queries(job_id, query_text, gl, hl, location, num, page) nulls not distinct;
create index job_queries_claim_idx
  on public.job_queries(priority, id) where status = 'pending';
create index job_queries_lease_idx
  on public.job_queries(lease_expires_at) where status = 'running';

grant select, insert on public.job_queries to worker;
create policy job_queries_worker_select on public.job_queries
  for select to worker using (true);
create policy job_queries_worker_insert on public.job_queries
  for insert to worker with check (
    exists (select 1 from public.jobs j where j.id = job_id and j.status = 'running')
  );

-- Query rows are created in the pickup transaction, before Running is visible.
-- S4/S5 will refine this when budget exhaustion intentionally leaves pending rows.
create or replace function public.job_work_pending(p_job_id uuid)
returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v text[] := '{}';
begin
  if exists (select 1 from public.opportunities o
    where o.job_id = p_job_id and o.check_status in ('pending','running')) then
    v := array_append(v, 'checks_pending');
  end if;
  if exists (select 1 from public.job_queries q
    where q.job_id = p_job_id and q.status in ('pending','running')) then
    v := array_append(v, 'queries_pending');
  end if;
  return v;
end;
$$;
