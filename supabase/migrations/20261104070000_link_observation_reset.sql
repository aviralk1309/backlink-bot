-- An edited source or target is a new link observation, not the previously verified one.
create function public.reset_changed_link_observation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_url is distinct from old.source_url
    or new.target_url is distinct from old.target_url then
    new.first_seen_at := null;
    new.last_checked_at := null;
  end if;
  return new;
end;
$$;
create trigger link_placements_reset_changed_observation
  before update of source_url,target_url on public.link_placements
  for each row execute function public.reset_changed_link_observation();
