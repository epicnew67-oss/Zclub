-- Approval must make a newly approved listing visible to buyers. Existing
-- inactive approvals are left alone because some were deliberately hidden.
create or replace function public.activate_listing_on_approval()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'pending_review' and new.status = 'approved'
     and new.soft_deleted_at is null then
    new.is_active := true;
  end if;
  return new;
end $$;
drop trigger if exists activate_listing_on_approval on public.listings;
create trigger activate_listing_on_approval
before update of status on public.listings
for each row execute function public.activate_listing_on_approval();

-- A known slot id must not bypass an inactive seller/listing's public state.
create or replace function public.check_booking_listing_active()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.listings l
    join public.seller_profiles sp on sp.id = l.seller_id
    where l.id = new.listing_id and l.status = 'approved'
      and l.is_active and l.soft_deleted_at is null
      and sp.is_active and sp.soft_deleted_at is null
  ) then
    raise exception 'listing_unavailable' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists check_booking_listing_active on public.bookings;
create trigger check_booking_listing_active
before insert on public.bookings
for each row execute function public.check_booking_listing_active();

-- Admins may give any nonempty reason; sellers can still unpublish their own
-- approved listing without one. Repeating the action is harmless.
create or replace function public.unpublish_listing(
  _listing_id uuid, _reason text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row public.listings;
  v_is_admin boolean;
  v_owner uuid;
  v_reason text := btrim(coalesce(_reason, ''));
  v_blocked integer := 0;
begin
  if v_user is null then
    raise exception 'unpublish_listing: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.listings where id = _listing_id for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id using errcode = 'foreign_key_violation';
  end if;
  v_is_admin := public.user_has_role('support'::public.user_role)
                or public.user_has_role('finance'::public.user_role)
                or public.user_has_role('owner'::public.user_role);
  select sp.user_id into v_owner from public.seller_profiles sp where sp.id = v_row.seller_id;
  if v_is_admin then
    if v_reason = '' then
      raise exception 'A reason is required to unpublish a listing'
        using errcode = 'check_violation';
    end if;
  elsif v_owner <> v_user then
    raise exception 'unpublish_listing: not the listing owner'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.status = 'unpublished' or v_row.soft_deleted_at is not null then
    return jsonb_build_object('ok', true, 'already_unpublished', true);
  end if;
  if v_row.status <> 'approved' then
    raise exception 'Listing is % and is not public; refresh the moderation list', v_row.status
      using errcode = 'check_violation';
  end if;
  update public.listings set status = 'unpublished', is_active = false,
      unpublished_reason = nullif(v_reason, ''), updated_at = now()
  where id = v_row.id;
  update public.availability_slots set status = 'blocked'
  where listing_id = v_row.id and status = 'open';
  get diagnostics v_blocked = row_count;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_user, 'listing.unpublish', 'listing', v_row.id,
          jsonb_build_object('reason', nullif(v_reason, ''), 'by_admin', v_is_admin,
            'blocked_open_slots', v_blocked,
            'diff', jsonb_build_object('status',
              jsonb_build_object('before', 'approved', 'after', 'unpublished'))));
  return jsonb_build_object('ok', true, 'blocked_open_slots', v_blocked);
end $$;
revoke all on function public.unpublish_listing(uuid, text) from public, anon;
grant execute on function public.unpublish_listing(uuid, text) to authenticated;
