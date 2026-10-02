-- Seller chooses whether buyers can book. The heartbeat also has to be
-- recent, so closing a browser eventually removes an online seller.
alter table public.seller_profiles
  add column if not exists wants_online boolean not null default false;

update public.seller_profiles set wants_online = true
where last_seen_at > now() - interval '90 seconds';

create or replace function public.set_seller_online(_online boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or _online is null then
    raise exception 'Sign in and choose online or offline'
      using errcode = 'invalid_parameter_value';
  end if;
  update public.seller_profiles
    set wants_online = _online,
        last_seen_at = case when _online then now() else null end
    where user_id = v_actor and is_active and soft_deleted_at is null;
  if not found then
    raise exception 'Active seller profile required'
      using errcode = 'insufficient_privilege';
  end if;
  return _online;
end;
$$;
revoke all on function public.set_seller_online(boolean) from public, anon;
grant execute on function public.set_seller_online(boolean) to authenticated;

create or replace function public.seller_heartbeat()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.seller_profiles set last_seen_at = now()
    where user_id = auth.uid() and wants_online and is_active
      and soft_deleted_at is null;
end;
$$;
revoke all on function public.seller_heartbeat() from public, anon;
grant execute on function public.seller_heartbeat() to authenticated;
