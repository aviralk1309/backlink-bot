-- M1-S1: identity schema (profiles, roles, permissions, role_permissions)
-- Deviation from plan: profiles.status replaces is_active, to support
-- self sign-up with admin approval (pending -> active | rejected).
-- role_id is nullable while pending; a CHECK forces a role once active.

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_system boolean not null default false,
  is_protected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_name_not_blank check (length(btrim(name)) > 0)
);

create unique index roles_name_lower_key on public.roles (lower(name));

create table public.permissions (
  key text primary key,
  "group" text not null,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create index role_permissions_permission_key_idx
  on public.role_permissions (permission_key);

create type public.profile_status as enum (
  'pending',
  'active',
  'rejected',
  'deactivated'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role_id uuid references public.roles (id) on delete restrict,
  status public.profile_status not null default 'pending',
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_active_requires_role
    check (status <> 'active' or role_id is not null)
);

create unique index profiles_email_lower_key on public.profiles (lower(email));
create index profiles_role_id_idx on public.profiles (role_id);
create index profiles_status_idx on public.profiles (status);

-- updated_at maintenance
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new auth user gets a pending profile. Invite and bootstrap flows
-- (service key) promote it to active with a role right after creation.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();