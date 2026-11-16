-- M4-S4: save_csv_mapping() RPC.
--
-- Design notes
--  * Clients cannot write status (S1 column grants), so this SECURITY DEFINER
--    function is the only client path from 'uploaded' or 'mapped' to 'mapped'.
--  * Re-mapping is allowed: a user may change the mapping before the worker
--    picks the file up. Once the worker claims it ('processing'), the RLS
--    update policy blocks direct writes and the status guard here refuses too.
--  * The mapping jsonb is validated lightly: must be an object with an integer
--    url_index. Full structural validation happens in the worker (M4-S5),
--    which can give richer error messages and set status='failed' on bad data.
--  * template_id is optional; when provided, it must reference an existing
--    mapping_templates row (FK on csv_uploads handles this).

create or replace function public.save_csv_mapping(
  p_upload_id  uuid,
  p_mapping    jsonb,
  p_template_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_upload public.csv_uploads;
  v_job_status text;
begin
  -- Permission gate
  if not public.has_permission('csv.upload') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Lock the row
  select * into v_upload from public.csv_uploads where id = p_upload_id for update;
  if not found then
    raise exception 'upload_not_found' using errcode = 'P0002';
  end if;

  -- Job must still be Draft
  select status::text into v_job_status from public.jobs where id = v_upload.job_id;
  if v_job_status is distinct from 'draft' then
    raise exception 'job_not_draft' using errcode = '55000';
  end if;

  -- Only 'uploaded' and 'mapped' accept a new mapping.
  -- 'processing': the worker already claimed it.
  -- 'ready'/'confirmed': the data has been staged; discard first.
  -- 'failed'/'discarded': re-upload instead.
  if v_upload.status not in ('uploaded', 'mapped') then
    raise exception 'upload_status_invalid: expected uploaded or mapped, got %', v_upload.status
      using errcode = '55000';
  end if;

  -- Light validation: must be an object with a non-negative integer url_index.
  if jsonb_typeof(p_mapping) <> 'object' then
    raise exception 'mapping_not_object' using errcode = '22023';
  end if;
  if not (p_mapping ? 'url_index')
     or jsonb_typeof(p_mapping -> 'url_index') <> 'number'
     or (p_mapping ->> 'url_index')::numeric <> trunc((p_mapping ->> 'url_index')::numeric)
     or (p_mapping ->> 'url_index')::numeric < 0
  then
    raise exception 'mapping_missing_url_index' using errcode = '22023';
  end if;

  -- Apply
  update public.csv_uploads
     set mapping     = p_mapping,
         template_id = p_template_id,
         status      = 'mapped'
   where id = p_upload_id;
end;
$$;

revoke all on function public.save_csv_mapping(uuid, jsonb, uuid) from public, anon;
grant execute on function public.save_csv_mapping(uuid, jsonb, uuid) to authenticated;

comment on function public.save_csv_mapping(uuid, jsonb, uuid) is
  'Saves a column mapping on a CSV upload and transitions status to mapped. Needs csv.upload. Requires the job to be Draft and the upload to be uploaded or mapped.';
