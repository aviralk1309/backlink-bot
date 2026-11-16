-- first_ready evidence is written only through the security-definer assignment RPC.
create or replace function public.opportunities_first_ready_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' and new.first_ready then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'first_ready_is_assignment_managed' using errcode='23514';
    end if;
  elsif tg_op='UPDATE' and
     (new.first_ready is distinct from old.first_ready
       or new.first_ready_rank is distinct from old.first_ready_rank) then
    if current_user not in ('postgres','supabase_admin') then
      raise exception 'first_ready_is_assignment_managed' using errcode='23514';
    end if;
    if old.first_ready and
       (new.first_ready is distinct from old.first_ready
         or new.first_ready_rank is distinct from old.first_ready_rank) then
      raise exception 'first_ready_membership_immutable' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
