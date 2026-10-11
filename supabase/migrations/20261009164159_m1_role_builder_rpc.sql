-- M1-S7: role builder support functions.
--
-- save_role runs as the caller (security invoker), so RLS and the lockout
-- triggers from M1-S4 still apply to every write. It exists only to make
-- "save role + permission set" one atomic transaction.
--
-- role_user_counts is security definer because profiles RLS hides other
-- users from callers that lack users.manage. It is gated by roles.manage.

create function public.role_user_counts()
returns table (role_id uuid, user_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.role_id, count(*)
  from public.profiles p
  where public.has_permission('roles.manage')
    and p.role_id is not null
  group by p.role_id
$$;

create function public.save_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_keys text[];
begin
  if not public.has_permission('roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_keys := coalesce(
    (select array_agg(distinct k) from unnest(p_permission_keys) as k),
    '{}'::text[]
  );

  if exists (
    select 1
    from unnest(v_keys) as k
    where k not in (select pm.key from public.permissions pm)
  ) then
    raise exception 'invalid_permission';
  end if;

  if p_role_id is null then
    insert into public.roles (name, description)
    values (
      btrim(p_name),
      nullif(btrim(coalesce(p_description, '')), '')
    )
    returning id into v_id;
  else
    update public.roles
       set name = btrim(p_name),
           description = nullif(btrim(coalesce(p_description, '')), '')
     where id = p_role_id
    returning id into v_id;

    if v_id is null then
      raise exception 'role_not_found';
    end if;
  end if;

  -- Diff, not replace: untouched rows never fire the lockout trigger.
  delete from public.role_permissions rp
   where rp.role_id = v_id
     and not (rp.permission_key = any (v_keys));

  insert into public.role_permissions (role_id, permission_key)
  select v_id, k from unnest(v_keys) as k
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.role_user_counts() from public, anon;
revoke all on function public.save_role(uuid, text, text, text[]) from public, anon;
grant execute on function public.role_user_counts() to authenticated;
grant execute on function public.save_role(uuid, text, text, text[]) to authenticated;