-- M4-S2: private Storage bucket for CSV files, and discard_csv_upload().
--
-- Design notes
--  * Browser uploads straight to Storage with the user's own session, so the
--    file never passes through a Next.js server action (body limits) and RLS
--    on storage.objects is the real gate. A csv_uploads row is created only
--    AFTER the file exists (registerCsvUploadAction), so no row ever points at
--    a missing file. The cost: a failed register can leave an orphan object.
--    A sweep for orphans is a later step (see M4 follow-ups).
--  * Object name is '<job_id>/<upload_id>.csv'. The name is fixed by a regex,
--    so users cannot choose folders, extensions or other jobs' paths.
--  * Objects are write-once for clients: no update, no delete policy. The
--    worker reads with the service key (M4-S3).
--  * Limit is 104857600 bytes (100 MiB). The same number lives in
--    apps/web/src/features/csv/limits.ts. Local Storage also has a global cap
--    in supabase/config.toml ([storage] file_size_limit) that must be >= this.
--    Hosted: free plan caps uploads at 50 MB, so 100 MiB needs a paid plan.
--  * discard_csv_upload(): clients cannot write status (S1 grants), so this
--    SECURITY DEFINER function is the only client path to 'discarded'.
--    It refuses 'processing' (the worker would overwrite it on finish).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('csv-uploads', 'csv-uploads', false, 104857600, array['text/csv'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload: csv.upload, a well-formed path, and a job that is still Draft.
create policy csv_uploads_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'csv-uploads'
    and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$'
    and public.has_permission('csv.upload')
    -- objects.name must stay qualified: public.jobs has its own "name" column,
    -- and an unqualified name inside this subquery would mean the job's name.
    and exists (
      select 1 from public.jobs j
      where j.id::text = split_part(objects.name, '/', 1) and j.status = 'draft'
    )
  );

-- Read: same permission as reading staged rows (competitor data).
create policy csv_uploads_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'csv-uploads' and public.has_permission('csv.upload'));

-- ---------------------------------------------------------------------
-- discard_csv_upload
-- ---------------------------------------------------------------------
create function public.discard_csv_upload(p_upload_id uuid)
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

  -- Already gone: nothing to do (safe to retry).
  if v_upload.status = 'discarded' then
    return;
  end if;

  if v_upload.status = 'processing' then
    raise exception 'upload_processing' using errcode = '55000';
  end if;

  delete from public.csv_rows where upload_id = p_upload_id;

  update public.csv_uploads
     set status = 'discarded',
         status_reason = 'Discarded by a team member',
         confirmed_at = null
   where id = p_upload_id;
end;
$$;

revoke all on function public.discard_csv_upload(uuid) from public, anon;
grant execute on function public.discard_csv_upload(uuid) to authenticated;

comment on function public.discard_csv_upload(uuid) is
  'Discards a CSV upload of a Draft job and removes its staged rows. Needs csv.upload. Refuses processing files.';