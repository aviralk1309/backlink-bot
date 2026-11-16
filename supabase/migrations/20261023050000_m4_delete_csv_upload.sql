-- M4-S8: delete_csv_upload RPC for Uploads tab UX (delete or replace file)

create or replace function public.delete_csv_upload(p_upload_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_upload public.csv_uploads;
  v_job_status text;
  v_storage_path text;
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

  if v_upload.status = 'processing' then
    raise exception 'upload_processing' using errcode = '55000';
  end if;

  v_storage_path := v_upload.storage_path;
  delete from public.csv_uploads where id = p_upload_id;

  return v_storage_path;
end;
$$;

revoke all on function public.delete_csv_upload(uuid) from public, anon;
grant execute on function public.delete_csv_upload(uuid) to authenticated;
