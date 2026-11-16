-- Keep a durable retry target when a job is deleted. Storage objects must be
-- removed through the Storage API, after the database transaction commits.
-- Rollback: drop the trigger, function, and table after draining pending rows.
create table public.job_storage_cleanup (
  job_id uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on public.job_storage_cleanup from public, anon, authenticated;
grant select, delete on public.job_storage_cleanup to worker;

alter table public.job_storage_cleanup enable row level security;
create policy worker_select on public.job_storage_cleanup
  for select to worker using (true);
create policy worker_delete on public.job_storage_cleanup
  for delete to worker using (true);

create function public.queue_job_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_storage_cleanup (job_id) values (old.id)
    on conflict (job_id) do nothing;
  return old;
end;
$$;

revoke all on function public.queue_job_storage_cleanup() from public, anon, authenticated;

create trigger jobs_queue_storage_cleanup
  after delete on public.jobs
  for each row execute function public.queue_job_storage_cleanup();

