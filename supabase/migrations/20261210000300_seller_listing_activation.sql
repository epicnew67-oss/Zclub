-- Let sellers activate older approved listings left inactive by the old
-- approval path, and pause listings without deleting their orders or slots.
create or replace function public.set_own_listing_active(
  _listing_id uuid, _active boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_listing public.listings;
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'set_own_listing_active: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_listing from public.listings where id = _listing_id for update;
  select user_id into v_owner from public.seller_profiles where id = v_listing.seller_id;
  if v_listing.id is null or v_owner <> v_user then
    raise exception 'set_own_listing_active: listing not found or not owned'
      using errcode = 'insufficient_privilege';
  end if;
  if v_listing.status <> 'approved' or v_listing.soft_deleted_at is not null then
    raise exception 'Only approved listings can be activated or paused'
      using errcode = 'check_violation';
  end if;
  if v_listing.is_active = _active then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  update public.listings set is_active = _active, updated_at = now()
  where id = _listing_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_user, case when _active then 'listing.activate' else 'listing.pause' end,
          'listing', _listing_id,
          jsonb_build_object('is_active_before', v_listing.is_active,
                             'is_active_after', _active));
  return jsonb_build_object('ok', true, 'is_active', _active);
end $$;
revoke all on function public.set_own_listing_active(uuid, boolean) from public, anon;
grant execute on function public.set_own_listing_active(uuid, boolean) to authenticated;
