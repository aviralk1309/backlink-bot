-- M8-S8: confirmed client exports flag matching Google discoveries without filtering them.
-- shortcut: client-domain evidence is still in csv_rows; preserve or materialize it before M9-S3 purges staging.
create function public.flag_google_client_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_type <> 'google' then return new; end if;

  update public.opportunities o set
    client_link_status = 'known_partial',
    flags = case when exists (
      select 1 from public.csv_uploads u
      join public.csv_rows r on r.upload_id = u.id
      where u.job_id = o.job_id and u.kind = 'client' and u.status = 'confirmed'
        and r.is_valid and r.domain = o.domain
    ) then o.flags || '{"already_links_to_client":true}'::jsonb else o.flags end
  where o.id = new.opportunity_id and exists (
    select 1 from public.csv_uploads u
    where u.job_id = o.job_id and u.kind = 'client' and u.status = 'confirmed'
  ) and (o.client_link_status <> 'known_partial'
    or not o.flags @> '{"already_links_to_client":true}'::jsonb);
  return new;
end;
$$;
revoke all on function public.flag_google_client_links()
  from public, anon, authenticated, service_role, worker;
create trigger opportunity_sources_client_link_flag
  after insert on public.opportunity_sources for each row
  execute function public.flag_google_client_links();
