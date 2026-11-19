-- Keep the domain evidence needed by Google discoveries after CSV staging is purged.
create table public.job_client_domains (
  job_id uuid not null references public.jobs(id) on delete cascade,
  domain text not null,
  primary key (job_id, domain)
);
revoke all on public.job_client_domains from public, anon, authenticated;
grant select, insert on public.job_client_domains to worker;
alter table public.job_client_domains enable row level security;
create policy worker_all on public.job_client_domains to worker using (true) with check (true);

-- Preserve evidence for jobs that already imported before this migration.
insert into public.job_client_domains(job_id, domain)
select distinct u.job_id, r.domain
from public.csv_uploads u
join public.csv_rows r on r.upload_id = u.id
where u.kind = 'client' and u.status = 'confirmed' and r.is_valid and r.domain is not null
on conflict do nothing;

create or replace function public.flag_google_client_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_type <> 'google' then return new; end if;

  update public.opportunities o set
    client_link_status = 'known_partial',
    flags = case when exists (
      select 1 from public.job_client_domains d
      where d.job_id = o.job_id and d.domain = o.domain
    ) or exists (
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
