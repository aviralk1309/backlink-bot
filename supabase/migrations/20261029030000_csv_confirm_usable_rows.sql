-- A ready CSV must contain a nonduplicate valid row before confirmation.
-- Rollback: restore the prior confirm_csv_upload function body; no data changes.
create or replace function public.confirm_csv_upload(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_upload public.csv_uploads;
  v_job_status text;
begin
  if not public.has_permission('csv.upload') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select * into v_upload from public.csv_uploads where id = p_upload_id for update;
  if not found then
    raise exception 'upload_not_found' using errcode = 'P0002';
  end if;

  select status::text into v_job_status from public.jobs where id = v_upload.job_id;
  if v_job_status is distinct from 'draft' then
    raise exception 'job_not_draft' using errcode = '55000';
  end if;

  if v_upload.status = 'confirmed' then
    return;
  end if;

  if v_upload.status <> 'ready' then
    raise exception 'upload_not_ready: expected ready, got %', v_upload.status
      using errcode = '55000';
  end if;

  if v_upload.valid_rows <= v_upload.duplicate_rows then
    raise exception 'upload_no_usable_rows' using errcode = '55000';
  end if;

  update public.csv_uploads
     set status = 'confirmed',
         confirmed_at = coalesce(confirmed_at, now())
   where id = p_upload_id;
end;
$$;

comment on function public.confirm_csv_upload(uuid) is
  'Confirms a ready CSV with a nonduplicate valid row. Requires csv.upload and draft job.';
