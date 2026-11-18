-- Deleting an upload records every Storage object before its DB row disappears.
-- Rollback only after this queue is drained.
create table public.csv_storage_cleanup (
  path text primary key,
  job_id uuid not null,
  upload_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create index csv_storage_cleanup_job_id_idx
  on public.csv_storage_cleanup (job_id, created_at);
create index csv_storage_cleanup_created_at_idx
  on public.csv_storage_cleanup (created_at);

revoke all on public.csv_storage_cleanup from public, anon, authenticated, service_role, worker;
grant select on public.csv_storage_cleanup to authenticated;
grant select, delete on public.csv_storage_cleanup to worker, service_role;
alter table public.csv_storage_cleanup enable row level security;
create policy csv_storage_cleanup_select on public.csv_storage_cleanup
  for select to authenticated using (public.has_permission('csv.upload'));
create policy worker_select on public.csv_storage_cleanup
  for select to worker using (true);
create policy worker_delete on public.csv_storage_cleanup
  for delete to worker using (true);

create function public.queue_csv_storage_cleanup()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.csv_storage_cleanup (path, job_id, upload_id)
  select v.path, old.job_id, old.id
  from (values (old.storage_path), (old.error_report_path)) as v(path)
  where v.path is not null and btrim(v.path) <> ''
  on conflict (path) do nothing;
  return old;
end;
$$;

revoke all on function public.queue_csv_storage_cleanup() from public, anon, authenticated;
create trigger csv_uploads_queue_storage_cleanup
  after delete on public.csv_uploads
  for each row execute function public.queue_csv_storage_cleanup();
