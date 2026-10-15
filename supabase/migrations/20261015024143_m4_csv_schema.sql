-- M4-S1: CSV upload schema (mapping_templates, csv_uploads, csv_rows).
--
-- Design notes
--  * Files live in Supabase Storage (M4-S2). The worker parses them (ADR 0008)
--    and stages one row per CSV line in csv_rows. Staging is purged after the
--    import is confirmed (M9-S3), so it is a working table, not a record.
--  * Clients never write status or counts. Status moves through SQL functions
--    and the worker (later M4 steps). Clients may insert an upload, and save a
--    mapping on an upload that is not yet imported. Column grants enforce it.
--  * Uploads are accepted only while the job is Draft. The gap is computed
--    from CONFIRMED uploads when the job is picked up (M4-S6), so a later
--    upload could never be seen. Edit-after-start is a product decision (M4-P1).
--  * One ACTIVE competitor upload per (job, label). Re-uploading a label means
--    the old row is set to 'discarded' (history kept, I3) and a new row is
--    created. Several client files per job are allowed (GSC is partial, so a
--    team may add an Ahrefs export too). DEFAULT-ASSUMED, confirm in M4-P1.
--  * Competitor label = registered domain, same shape as blocklist.domain.
--    G10 counts DISTINCT labels, so labels must be normalized before insert.
--  * csv_rows uses the same URL and domain shape rules as opportunities, so a
--    valid staged row can never fail the opportunities constraints at import.
--  * Counts contract (checked when status is ready or confirmed):
--      total_rows = valid_rows + invalid_rows + empty_rows
--      duplicate_rows is a SUBSET of valid_rows (repeat URL inside the file).
--  * mapping jsonb contract (the mapping screen and the worker rely on it):
--      { "url_column": "<header text>",
--        "columns": [ { "source": "<header>", "label": "<name>",
--                       "type": "text" | "number" | "date" | "ignore" } ] }
--    Header-based, not index-based, so a template matches any export with the
--    same headers. The database checks only that it is an object.
--  * RLS: reading upload summaries needs jobs.view. Reading staged rows needs
--    csv.upload (raw URLs and extra columns are competitor data).

create type public.csv_upload_status as enum (
  'uploaded',    -- file in storage, no mapping yet
  'mapped',      -- mapping saved, waiting for the worker
  'processing',  -- worker is reading the file
  'ready',       -- validated, import summary shown, waiting for confirm
  'confirmed',   -- team accepted the summary, counts toward the gap
  'failed',      -- unreadable file or worker error, see status_reason
  'discarded'    -- replaced or removed, kept for history (I3)
);

-- ---------------------------------------------------------------------
-- mapping_templates
-- ---------------------------------------------------------------------
create table public.mapping_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  mapping jsonb not null,
  shared boolean not null default true,
  created_by uuid default auth.uid()
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mapping_templates_name_not_blank check (length(btrim(name)) > 0),
  constraint mapping_templates_name_length check (char_length(name) <= 100),
  constraint mapping_templates_kind_check check (kind in ('competitor', 'client')),
  constraint mapping_templates_mapping_object check (jsonb_typeof(mapping) = 'object')
);

create unique index mapping_templates_kind_name_key
  on public.mapping_templates (kind, lower(name));

create index mapping_templates_created_by_idx
  on public.mapping_templates (created_by);

create trigger mapping_templates_set_updated_at
  before update on public.mapping_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- csv_uploads
-- ---------------------------------------------------------------------
create table public.csv_uploads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,

  kind text not null,
  -- competitor: the competitor's registered domain. client: null.
  competitor_label text,

  filename text not null,
  storage_path text not null,
  size_bytes bigint not null,

  status public.csv_upload_status not null default 'uploaded',
  status_reason text,

  mapping jsonb,
  template_id uuid references public.mapping_templates (id) on delete set null,
  -- Worker findings: { encoding, delimiter, header_row, ... }
  file_info jsonb not null default '{}'::jsonb,

  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  empty_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  error_report_path text,

  uploaded_by uuid default auth.uid()
    references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint csv_uploads_kind_check check (kind in ('competitor', 'client')),
  constraint csv_uploads_label_by_kind
    check (
      (kind = 'competitor' and competitor_label is not null)
      or (kind = 'client' and competitor_label is null)
    ),
  -- Same shape as blocklist.domain
  constraint csv_uploads_label_format
    check (
      competitor_label is null
      or competitor_label ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$'
    ),
  constraint csv_uploads_filename_valid
    check (length(btrim(filename)) > 0 and char_length(filename) <= 255),
  constraint csv_uploads_storage_path_valid
    check (length(btrim(storage_path)) > 0 and char_length(storage_path) <= 1024),
  constraint csv_uploads_storage_path_key unique (storage_path),
  constraint csv_uploads_size_positive check (size_bytes > 0),
  constraint csv_uploads_mapping_object
    check (mapping is null or jsonb_typeof(mapping) = 'object'),
  constraint csv_uploads_file_info_object check (jsonb_typeof(file_info) = 'object'),
  constraint csv_uploads_mapped_has_mapping
    check (
      status not in ('mapped', 'processing', 'ready', 'confirmed')
      or mapping is not null
    ),
  constraint csv_uploads_counts_nonneg
    check (
      total_rows >= 0 and valid_rows >= 0 and invalid_rows >= 0
      and empty_rows >= 0 and duplicate_rows >= 0
    ),
  constraint csv_uploads_duplicates_within_valid
    check (duplicate_rows <= valid_rows),
  constraint csv_uploads_counts_add_up
    check (
      status not in ('ready', 'confirmed')
      or total_rows = valid_rows + invalid_rows + empty_rows
    ),
  constraint csv_uploads_confirmed_has_time
    check (status <> 'confirmed' or confirmed_at is not null)
);

-- One active competitor file per (job, label). A failed or discarded file
-- does not block a re-upload of the same label.
create unique index csv_uploads_active_competitor_key
  on public.csv_uploads (job_id, competitor_label)
  where kind = 'competitor' and status not in ('failed', 'discarded');

create index csv_uploads_job_idx on public.csv_uploads (job_id, created_at desc);

-- Worker: files waiting to be read or being read.
create index csv_uploads_work_idx
  on public.csv_uploads (status, created_at)
  where status in ('mapped', 'processing');

create index csv_uploads_template_idx
  on public.csv_uploads (template_id)
  where template_id is not null;

create trigger csv_uploads_set_updated_at
  before update on public.csv_uploads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- csv_rows: staging, one row per CSV line (empty and invalid lines included,
-- so the import summary can show every reason, I3)
-- ---------------------------------------------------------------------
create table public.csv_rows (
  upload_id uuid not null references public.csv_uploads (id) on delete cascade,
  row_no integer not null,
  -- Truncated by the worker when longer than the limit.
  raw_url text not null,
  normalized_url text,
  host text,
  domain text,
  -- Optional columns from the file, keyed by the mapping labels.
  extras jsonb not null default '{}'::jsonb,
  is_valid boolean not null,
  -- Repeat of a normalized URL earlier in the same file.
  is_duplicate boolean not null default false,
  -- empty_row, bad_url, not_http, too_long, ...
  error_code text,
  primary key (upload_id, row_no),
  constraint csv_rows_row_no_positive check (row_no >= 1),
  constraint csv_rows_raw_url_length check (char_length(raw_url) <= 4096),
  constraint csv_rows_normalized_url_https
    check (
      normalized_url is null
      or (normalized_url ~ '^https://[^[:space:]]+$' and char_length(normalized_url) <= 2100)
    ),
  constraint csv_rows_domain_format
    check (
      domain is null
      or domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$'
    ),
  constraint csv_rows_extras_object check (jsonb_typeof(extras) = 'object'),
  constraint csv_rows_valid_has_fields
    check (
      not is_valid
      or (normalized_url is not null and host is not null
          and domain is not null and error_code is null)
    ),
  constraint csv_rows_invalid_has_error
    check (is_valid or error_code is not null),
  constraint csv_rows_duplicate_only_valid
    check (not is_duplicate or is_valid)
);

-- Gap calculation (M4-S6): distinct domains of valid rows per upload.
create index csv_rows_upload_domain_idx
  on public.csv_rows (upload_id, domain)
  where is_valid;

-- Import summary: invalid rows by reason, sample errors.
create index csv_rows_upload_error_idx
  on public.csv_rows (upload_id, error_code)
  where not is_valid;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on public.mapping_templates from anon, authenticated;
revoke all on public.csv_uploads from anon, authenticated;
revoke all on public.csv_rows from anon, authenticated;

grant select on public.mapping_templates to authenticated;
grant insert (name, kind, mapping, shared) on public.mapping_templates to authenticated;
grant update (name, mapping, shared) on public.mapping_templates to authenticated;
grant delete on public.mapping_templates to authenticated;

-- csv_uploads: no status, counts, file_info or delete for clients.
grant select on public.csv_uploads to authenticated;
grant insert (job_id, kind, competitor_label, filename, storage_path, size_bytes)
  on public.csv_uploads to authenticated;
grant update (mapping, template_id) on public.csv_uploads to authenticated;

grant select on public.csv_rows to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.mapping_templates enable row level security;
alter table public.csv_uploads enable row level security;
alter table public.csv_rows enable row level security;

-- Templates: shared ones, and your own.
create policy mapping_templates_select on public.mapping_templates
  for select to authenticated
  using (
    (public.has_permission('csv.upload') or public.has_permission('mapping_templates.manage'))
    and (shared or created_by = auth.uid())
  );

create policy mapping_templates_insert on public.mapping_templates
  for insert to authenticated
  with check (public.has_permission('mapping_templates.manage'));

create policy mapping_templates_update on public.mapping_templates
  for update to authenticated
  using (
    public.has_permission('mapping_templates.manage')
    and (shared or created_by = auth.uid())
  )
  with check (public.has_permission('mapping_templates.manage'));

create policy mapping_templates_delete on public.mapping_templates
  for delete to authenticated
  using (
    public.has_permission('mapping_templates.manage')
    and (shared or created_by = auth.uid())
  );

-- Uploads: the summary is visible to anyone who can see the job.
create policy csv_uploads_select on public.csv_uploads
  for select to authenticated
  using (public.has_permission('jobs.view'));

-- Only while the job is Draft (the gap is computed from the confirmed files
-- when the job is picked up).
create policy csv_uploads_insert on public.csv_uploads
  for insert to authenticated
  with check (
    public.has_permission('csv.upload')
    and exists (
      select 1 from public.jobs j where j.id = job_id and j.status = 'draft'
    )
  );

-- A mapping can be saved only while the file is 'uploaded'. From 'mapped' on
-- the worker may claim the file at any moment, so a client edit could be lost
-- silently. The uploaded -> mapped move, and any re-map, go through an RPC
-- (M4-S3) that takes the row lock and checks status.
create policy csv_uploads_update on public.csv_uploads
  for update to authenticated
  using (
    public.has_permission('csv.upload')
    and status = 'uploaded'
    and exists (
      select 1 from public.jobs j where j.id = job_id and j.status = 'draft'
    )
  )
  with check (public.has_permission('csv.upload'));

-- Staged rows: competitor data, so csv.upload, not just jobs.view.
create policy csv_rows_select on public.csv_rows
  for select to authenticated
  using (public.has_permission('csv.upload'));

-- ---------------------------------------------------------------------
-- The worker role (I12). Grants are the real limit; policies name the role.
-- ---------------------------------------------------------------------
grant select on public.mapping_templates to worker;
grant select, update on public.csv_uploads to worker;
grant select, insert, delete on public.csv_rows to worker;

create policy worker_select on public.mapping_templates
  for select to worker using (true);
create policy worker_select on public.csv_uploads
  for select to worker using (true);
create policy worker_update on public.csv_uploads
  for update to worker using (true) with check (true);
create policy worker_all on public.csv_rows
  for all to worker using (true) with check (true);