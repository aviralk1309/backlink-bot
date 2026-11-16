-- M4-S5: CSV validation and confirmation functions
--
-- Design notes
--  * Clients cannot write status (S1 column grants), so confirm_csv_upload()
--    is the only client path from 'ready' to 'confirmed'.
--  * Requires csv.upload permission and that the job is still in 'draft' status.
--  * Re-confirming an already 'confirmed' upload is an idempotent no-op.
--  * worker_claim_next_csv_upload() allows the worker to atomically claim the next
--    'mapped' upload with FOR UPDATE SKIP LOCKED, moving it to 'processing'.

-- ---------------------------------------------------------------------
-- confirm_csv_upload
-- ---------------------------------------------------------------------
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

  -- Idempotent if already confirmed
  if v_upload.status = 'confirmed' then
    return;
  end if;

  if v_upload.status <> 'ready' then
    raise exception 'upload_not_ready: expected ready, got %', v_upload.status
      using errcode = '55000';
  end if;

  update public.csv_uploads
     set status = 'confirmed',
         confirmed_at = coalesce(confirmed_at, now())
   where id = p_upload_id;
end;
$$;

revoke all on function public.confirm_csv_upload(uuid) from public, anon;
grant execute on function public.confirm_csv_upload(uuid) to authenticated;

comment on function public.confirm_csv_upload(uuid) is
  'Transitions a CSV upload from ready to confirmed. Requires csv.upload and draft job.';

-- ---------------------------------------------------------------------
-- worker_claim_next_csv_upload
-- ---------------------------------------------------------------------
create or replace function public.worker_claim_next_csv_upload()
returns table (
  id uuid,
  job_id uuid,
  kind text,
  competitor_label text,
  filename text,
  storage_path text,
  mapping jsonb,
  file_info jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with next_upload as (
    select u.id as upload_id
    from public.csv_uploads u
    join public.jobs j on j.id = u.job_id
    where u.status = 'mapped'
      and j.status = 'draft'
    order by u.created_at asc
    limit 1
    for update of u skip locked
  )
  update public.csv_uploads u
     set status = 'processing',
         status_reason = null,
         updated_at = now()
    from next_upload
   where u.id = next_upload.upload_id
  returning
    u.id,
    u.job_id,
    u.kind,
    u.competitor_label,
    u.filename,
    u.storage_path,
    u.mapping,
    u.file_info;
end;
$$;

revoke all on function public.worker_claim_next_csv_upload() from public, anon, authenticated;
grant execute on function public.worker_claim_next_csv_upload() to worker;

comment on function public.worker_claim_next_csv_upload() is
  'Claims the next mapped CSV upload for processing using FOR UPDATE SKIP LOCKED. Restricted to worker role.';
