-- D3: users.manage can assign only roles within its own permission set.
create function public.can_assign_role(p_role_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    public.has_permission('users.manage')
    and exists (select 1 from public.roles r where r.id = p_role_id)
    and (
      public.has_permission('roles.manage')
      or (
        not exists (select 1 from public.roles r
                    where r.id = p_role_id and r.is_protected)
        and not exists (
          select 1 from public.role_permissions wanted
          where wanted.role_id = p_role_id
            and not exists (
              select 1 from public.role_permissions held
              where held.role_id = public.current_role_id()
                and held.permission_key = wanted.permission_key
            )
        )
      )
    ), false
  )
$$;

revoke all on function public.can_assign_role(uuid) from public, anon;
grant execute on function public.can_assign_role(uuid) to authenticated;

create function public.guard_profile_role_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated'
     or new.role_id is not distinct from old.role_id
     or auth.uid() is null then
    return new;
  end if;
  if auth.uid() = old.id then
    raise exception 'self_role_change_forbidden' using errcode = '42501';
  end if;
  if not public.can_assign_role(new.role_id) then
    raise exception 'role_assignment_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_role_assignment() from public, anon, authenticated;
create trigger profiles_role_assignment_guard
  before update of role_id on public.profiles
  for each row execute function public.guard_profile_role_assignment();

create table public.profile_role_changes (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  actor_id uuid,
  old_role_id uuid,
  new_role_id uuid,
  changed_at timestamptz not null default clock_timestamp()
);
revoke all on public.profile_role_changes from public, anon, authenticated, service_role, worker;
alter table public.profile_role_changes enable row level security;

create function public.log_profile_role_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profile_role_changes
    (profile_id, actor_id, old_role_id, new_role_id)
  values (new.id, coalesce(auth.uid(), new.approved_by), old.role_id, new.role_id);
  return new;
end;
$$;

revoke all on function public.log_profile_role_change() from public, anon, authenticated;
create trigger profiles_log_role_change
  after update of role_id on public.profiles
  for each row when (old.role_id is distinct from new.role_id)
  execute function public.log_profile_role_change();
