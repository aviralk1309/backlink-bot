-- Search publication takes the same job lock as budgeted claims before
-- changing query status or credits. This also covers zero-result responses.
create function public.worker_lock_search_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.jobs j where j.id = p_job_id for no key update;
  return found;
end;
$$;
revoke all on function public.worker_lock_search_job(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_lock_search_job(uuid) to worker;
