-- Additive shared dispatch coordination. No existing job/domain data changes.
create table public.fetch_domain_limits (
  domain text primary key,
  next_allowed_at timestamptz not null
);
alter table public.fetch_domain_limits enable row level security;
revoke all on public.fetch_domain_limits from public, anon, authenticated, service_role, worker;

create function public.worker_acquire_fetch_slot(p_domain text, p_delay_seconds double precision)
returns double precision
language plpgsql security definer set search_path = ''
as $$
declare
  v_next timestamptz;
  v_now timestamptz;
begin
  if p_domain is null or p_domain = '' or length(p_domain) > 253
     or p_domain <> lower(btrim(p_domain)) or p_domain ~ '[^a-z0-9.:-]' then
    raise exception 'invalid_fetch_domain' using errcode = '22023';
  end if;
  if p_delay_seconds is null or not (p_delay_seconds between 0 and 3600) then
    raise exception 'invalid_fetch_delay' using errcode = '22023';
  end if;
  insert into public.fetch_domain_limits(domain, next_allowed_at)
    values (p_domain, '-infinity') on conflict (domain) do nothing;
  select next_allowed_at into v_next from public.fetch_domain_limits
    where domain = p_domain for update;
  v_now := clock_timestamp();
  if v_next > v_now then
    return extract(epoch from v_next - v_now)::double precision;
  end if;
  update public.fetch_domain_limits
    set next_allowed_at = v_now + make_interval(secs => p_delay_seconds)
    where domain = p_domain;
  return 0;
end;
$$;
revoke all on function public.worker_acquire_fetch_slot(text, double precision)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_acquire_fetch_slot(text, double precision) to worker;
comment on table public.fetch_domain_limits is
  'Shared registered-domain dispatch slots, including retries and redirects. Worker RPC only.';
