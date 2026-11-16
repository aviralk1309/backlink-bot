-- B3: durable CSV claims. Stop old CSV runners before applying (ADR 0015).
-- Existing rows are preserved; the reaper recovers legacy processing rows.
alter table public.csv_uploads
  add column locked_by text,
  add column claim_token uuid,
  add column lease_expires_at timestamptz,
  add column processing_attempts integer not null default 0,
  add constraint csv_uploads_attempts_nonnegative check (processing_attempts >= 0),
  add constraint csv_uploads_claim_consistent check (
    (locked_by is null and claim_token is null and lease_expires_at is null)
    or (status = 'processing' and locked_by is not null
        and claim_token is not null and lease_expires_at is not null)
  );

create index csv_uploads_expired_claims_idx on public.csv_uploads (lease_expires_at)
  where status = 'processing';

create function public.worker_reap_csv_uploads(p_max_attempts integer, p_limit integer default 500)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if p_max_attempts is null or p_max_attempts < 1
     or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_csv_reap_limits' using errcode = '22023';
  end if;
  with expired as (
    select u.id from public.csv_uploads u
    where (u.status = 'processing' and
           (u.lease_expires_at is null or u.lease_expires_at <= clock_timestamp()))
       or (u.status = 'mapped' and u.processing_attempts >= p_max_attempts)
    order by u.updated_at, u.id
    limit p_limit for update skip locked
  )
  update public.csv_uploads u
     set status = case when greatest(u.processing_attempts, 1) >= p_max_attempts
                       then 'failed' else 'mapped' end::public.csv_upload_status,
         status_reason = case when greatest(u.processing_attempts, 1) >= p_max_attempts
                              then 'csv_attempts_exhausted' else 'csv_lease_expired_retry' end,
         processing_attempts = greatest(u.processing_attempts, 1),
         locked_by = null, claim_token = null, lease_expires_at = null
    from expired e where u.id = e.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.worker_claim_csv_upload(
  p_worker_id text, p_lease_seconds integer, p_max_attempts integer
)
returns setof public.csv_uploads
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker_id is null or length(btrim(p_worker_id)) not between 1 and 200
     or p_lease_seconds is null or p_lease_seconds not between 10 and 3600
     or p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'invalid_csv_claim_parameters' using errcode = '22023';
  end if;
  return query
  with candidate as (
    select u.id from public.csv_uploads u
    join public.jobs j on j.id = u.job_id
    where u.status = 'mapped' and j.status = 'draft'
      and u.processing_attempts < p_max_attempts
    order by u.created_at, u.id
    limit 1 for update of u skip locked
  )
  update public.csv_uploads u
     set status = 'processing', status_reason = null,
         locked_by = p_worker_id, claim_token = gen_random_uuid(),
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         processing_attempts = u.processing_attempts + 1
    from candidate c where u.id = c.id returning u.*;
end;
$$;

create function public.worker_renew_csv_claim(
  p_upload_id uuid, p_claim_token uuid, p_lease_seconds integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_csv_lease_seconds' using errcode = '22023';
  end if;
  update public.csv_uploads
     set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
   where id = p_upload_id and claim_token = p_claim_token and status = 'processing'
     and lease_expires_at > clock_timestamp();
  return found;
end;
$$;

-- Keep the old signature for a clear, fail-closed upgrade error. Old runners
-- do not know their token and cannot safely participate in lease recovery.
create or replace function public.worker_claim_next_csv_upload()
returns table (
  id uuid, job_id uuid, kind text, competitor_label text, filename text,
  storage_path text, mapping jsonb, file_info jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'csv_worker_upgrade_required' using errcode = '55000';
end;
$$;

revoke all on function public.worker_reap_csv_uploads(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.worker_claim_csv_upload(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.worker_renew_csv_claim(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.worker_claim_next_csv_upload()
  from public, anon, authenticated, service_role;
grant execute on function public.worker_reap_csv_uploads(integer, integer) to worker;
grant execute on function public.worker_claim_csv_upload(text, integer, integer) to worker;
grant execute on function public.worker_renew_csv_claim(uuid, uuid, integer) to worker;

comment on column public.csv_uploads.claim_token is
  'Unique per attempt. Worker locks and checks this token before staging; final writes compare it.';
comment on column public.csv_uploads.processing_attempts is
  'Incremented on committed claim, including attempts lost to worker crashes.';
