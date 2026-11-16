-- M4-S5: get_csv_upload_error_counts() helper for import summary breakdown

create or replace function public.get_csv_upload_error_counts(p_upload_id uuid)
returns table (
  error_code text,
  count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('csv.upload') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select r.error_code, count(*) as count
  from public.csv_rows r
  where r.upload_id = p_upload_id
    and not r.is_valid
  group by r.error_code
  order by count desc;
end;
$$;

revoke all on function public.get_csv_upload_error_counts(uuid) from public, anon;
grant execute on function public.get_csv_upload_error_counts(uuid) to authenticated;

comment on function public.get_csv_upload_error_counts(uuid) is
  'Returns aggregate counts of invalid rows by error_code for the import summary.';
