-- Persist an IANA time zone chosen at registration or in account settings.
-- Existing profiles remain null and continue using their device time zone.
alter table public.profiles add column if not exists time_zone text;

create or replace function public.validate_profile_time_zone()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.time_zone is not null and not exists (
    select 1 from pg_timezone_names where name = new.time_zone
  ) then
    raise exception 'Invalid time zone: %', new.time_zone using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists validate_profile_time_zone on public.profiles;
create trigger validate_profile_time_zone before insert or update of time_zone
on public.profiles for each row execute function public.validate_profile_time_zone();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, time_zone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'time_zone', '')
  );
  insert into public.user_roles (user_id, role) values (new.id, 'buyer');
  insert into public.wallets (user_id) values (new.id);
  return new;
end $$;
