-- M1-S3 + M1-S4: authorization helpers, lockout guards, RLS.
-- Lockout errors use stable message codes the UI maps to plain language:
--   lockout_protected_role, lockout_role_in_use,
--   lockout_admin_permission, lockout_last_admin

-- ---------------------------------------------------------------------
-- Authorization helpers (security definer so RLS on the tables they read
-- cannot recurse). They only ever answer about auth.uid().
-- ---------------------------------------------------------------------
create function public.current_role_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.role_id
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid()
      and p.status = 'active'
      and rp.permission_key = p_key
  )
$$;

revoke all on function public.current_role_id() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.current_role_id() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- ---------------------------------------------------------------------
-- Lockout guards (I13)
-- ---------------------------------------------------------------------
create function public.guard_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_protected then
      raise exception 'lockout_protected_role';
    end if;
    if exists (select 1 from public.profiles where role_id = old.id) then
      raise exception 'lockout_role_in_use';
    end if;
    return old;
  end if;

  if new.is_protected is distinct from old.is_protected
     or new.is_system is distinct from old.is_system then
    raise exception 'lockout_protected_role';
  end if;
  return new;
end;
$$;

create trigger roles_guard
  before update or delete on public.roles
  for each row execute function public.guard_roles();

create function public.guard_role_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_protected boolean;
begin
  select r.is_protected into v_protected
  from public.roles r
  where r.id = old.role_id;

  -- If the role row is already gone there is nothing to protect.
  if coalesce(v_protected, false)
     and old.permission_key in ('roles.manage', 'users.manage') then
    raise exception 'lockout_admin_permission';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger role_permissions_guard
  before update or delete on public.role_permissions
  for each row execute function public.guard_role_permissions();

-- Block deactivating, deleting or demoting the last active Admin.
-- security definer: must see every profile regardless of caller RLS.
-- Advisory lock closes the race where two admins remove each other.
create function public.guard_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and old.role_id is not null
     and exists (
       select 1 from public.roles r
       where r.id = old.role_id and r.is_protected
     )
     and (
       tg_op = 'DELETE'
       or new.status <> 'active'
       or new.role_id is distinct from old.role_id
     )
  then
    perform pg_advisory_xact_lock(hashtext('m1_last_admin_guard'));

    if not exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where r.is_protected
        and p.status = 'active'
        and p.id <> old.id
    ) then
      raise exception 'lockout_last_admin';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update or delete on public.profiles
  for each row execute function public.guard_profiles();

-- ---------------------------------------------------------------------
-- Privileges: RLS is the gate, grants are defense in depth.
-- ---------------------------------------------------------------------
revoke all on public.roles from anon;
revoke all on public.permissions from anon;
revoke all on public.role_permissions from anon;
revoke all on public.profiles from anon;

-- The permission catalog changes only through migrations.
revoke insert, update, delete on public.permissions from authenticated;

-- Clients may change only these profile columns (and only via RLS).
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, role_id, status, approved_by, approved_at)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;

-- permissions: readable by active users, never writable from clients
create policy permissions_select on public.permissions
  for select to authenticated
  using (public.current_role_id() is not null);

-- roles
create policy roles_select on public.roles
  for select to authenticated
  using (public.current_role_id() is not null);

create policy roles_insert on public.roles
  for insert to authenticated
  with check (
    public.has_permission('roles.manage')
    and not is_system
    and not is_protected
  );

create policy roles_update on public.roles
  for update to authenticated
  using (public.has_permission('roles.manage'))
  with check (public.has_permission('roles.manage'));

create policy roles_delete on public.roles
  for delete to authenticated
  using (public.has_permission('roles.manage'));

-- role_permissions
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (public.current_role_id() is not null);

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (public.has_permission('roles.manage'));

create policy role_permissions_update on public.role_permissions
  for update to authenticated
  using (public.has_permission('roles.manage'))
  with check (public.has_permission('roles.manage'));

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (public.has_permission('roles.manage'));

-- profiles: everyone reads their own row (needed for the "pending" and
-- "deactivated" screens). users.manage reads and updates all rows.
-- Inserts and deletes happen only through triggers and the service key.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_managers on public.profiles
  for select to authenticated
  using (public.has_permission('users.manage'));

create policy profiles_update_managers on public.profiles
  for update to authenticated
  using (public.has_permission('users.manage'))
  with check (public.has_permission('users.manage'));