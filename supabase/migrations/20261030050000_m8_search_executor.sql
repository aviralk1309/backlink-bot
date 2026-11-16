-- M8-S4: the worker owns query claims and completion; readers remain read-only.
grant update (status, attempts, locked_by, lease_expires_at, credits_used,
  result_count, new_unique_domains, error, completed_at)
  on public.job_queries to worker;
create policy job_queries_worker_update on public.job_queries
  for update to worker using (true) with check (true);
