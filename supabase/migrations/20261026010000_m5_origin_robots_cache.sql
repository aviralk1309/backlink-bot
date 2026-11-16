-- Robots belongs to a service origin, never a registered-domain grouping.
-- Legacy domains robots/block fields are retained for compatibility, no longer consulted.
create table public.origin_robots_cache (
  origin text primary key check (length(origin) <= 320 and origin ~ '^https?://[^/]+:(80|443)$'),
  registered_domain text references public.domains(registered_domain),
  state text not null default 'unavailable' check (state in ('rules', 'absent', 'unavailable')),
  robots_txt text not null default '' check (octet_length(robots_txt) <= 524288),
  fetched_at timestamptz,
  expires_at timestamptz not null default '-infinity',
  refresh_token uuid,
  refresh_until timestamptz not null default '-infinity',
  blocked_until timestamptz not null default '-infinity'
);
create index origin_robots_domain_idx on public.origin_robots_cache(registered_domain);
alter table public.origin_robots_cache enable row level security;
revoke all on public.origin_robots_cache from public, anon, authenticated, service_role, worker;

create function public.worker_claim_robots(p_origin text, p_domain text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.origin_robots_cache;
  v_now timestamptz;
begin
  if p_token is null then raise exception 'invalid_robots_token' using errcode = '22023'; end if;
  if p_domain is not null then
    insert into public.domains(registered_domain) values (p_domain) on conflict do nothing;
  end if;
  insert into public.origin_robots_cache(origin, registered_domain)
    values (p_origin, p_domain) on conflict do nothing;
  select * into v_row from public.origin_robots_cache where origin = p_origin for update;
  v_now := clock_timestamp();
  if v_row.blocked_until > v_now then return jsonb_build_object('action', 'blocked'); end if;
  if v_row.expires_at > v_now then
    return jsonb_build_object('action', 'cached', 'state', v_row.state, 'robots_txt', v_row.robots_txt);
  end if;
  if v_row.refresh_until > v_now then return jsonb_build_object('action', 'wait'); end if;
  update public.origin_robots_cache set refresh_token = p_token,
    refresh_until = v_now + interval '60 seconds' where origin = p_origin;
  return jsonb_build_object('action', 'refresh');
end;
$$;

create function public.worker_complete_robots(
  p_origin text, p_token uuid, p_state text, p_text text, p_ttl integer
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_ttl is null or p_ttl not between 1 and 86400 then
    raise exception 'invalid_robots_ttl' using errcode = '22023';
  end if;
  update public.origin_robots_cache set state = p_state, robots_txt = p_text,
    fetched_at = clock_timestamp(), expires_at = clock_timestamp() + make_interval(secs => p_ttl),
    refresh_token = null, refresh_until = '-infinity'
    where origin = p_origin and refresh_token = p_token and refresh_until > clock_timestamp();
  return found;
end;
$$;

create function public.worker_block_origin(p_origin text, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_seconds is null or p_seconds not between 1 and 86400 then
    raise exception 'invalid_origin_cooldown' using errcode = '22023';
  end if;
  update public.origin_robots_cache
    set blocked_until = greatest(blocked_until, clock_timestamp() + make_interval(secs => p_seconds))
    where origin = p_origin;
  return found;
end;
$$;

revoke all on function public.worker_claim_robots(text,text,uuid),
  public.worker_complete_robots(text,uuid,text,text,integer), public.worker_block_origin(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_claim_robots(text,text,uuid),
  public.worker_complete_robots(text,uuid,text,text,integer), public.worker_block_origin(text,integer)
  to worker;
