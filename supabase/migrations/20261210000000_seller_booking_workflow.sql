-- A cancelled booking remains in history, but its future slot can be sold again.
-- The slot row is locked by purchase_slot, and this index is the final guard
-- against two non-cancelled bookings for the same slot.
alter table public.bookings drop constraint if exists bookings_slot_id_key;
create unique index if not exists bookings_one_active_per_slot_idx
  on public.bookings (slot_id) where status <> 'cancelled';

-- Sellers archive a listing instead of deleting records referenced by orders.
-- Existing paid calls stay bookable and visible in order history; open slots
-- are blocked so no new buyer can reserve them.
create or replace function public.archive_own_listing(_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.listings;
  v_owner uuid;
  v_blocked integer := 0;
begin
  if v_user is null then
    raise exception 'archive_own_listing: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_listing from public.listings
  where id = _listing_id for update;
  select sp.user_id into v_owner from public.seller_profiles sp
  where sp.id = v_listing.seller_id;

  if v_listing.id is null or v_owner <> v_user then
    raise exception 'archive_own_listing: listing not found or not owned'
      using errcode = 'insufficient_privilege';
  end if;
  if v_listing.soft_deleted_at is not null then
    return jsonb_build_object('ok', true, 'already_archived', true);
  end if;

  update public.listings
  set status = 'unpublished', is_active = false,
      soft_deleted_at = now(), updated_at = now()
  where id = _listing_id;

  update public.availability_slots
  set status = 'blocked'
  where listing_id = _listing_id and status = 'open';
  get diagnostics v_blocked = row_count;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_user, 'listing.archive', 'listing', _listing_id,
          jsonb_build_object('previous_status', v_listing.status,
                             'blocked_open_slots', v_blocked));

  return jsonb_build_object('ok', true, 'blocked_open_slots', v_blocked);
end $$;

revoke all on function public.archive_own_listing(uuid) from public, anon;
grant execute on function public.archive_own_listing(uuid) to authenticated;

-- The existing purchase RPC creates the seller notification in the same
-- transaction as the hold. Replace its opaque UUID body with useful context.
create or replace function public.describe_new_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_title text;
  v_buyer text;
  v_price integer;
begin
  if new.type <> 'booking' or new.title <> 'New booking' or new.link is null
     or new.link !~ '^/orders/[0-9a-fA-F-]{36}$' then
    return new;
  end if;
  v_id := substring(new.link from 9)::uuid;
  select l.title, coalesce(p.display_name, 'A buyer'), b.price_tokens
    into v_title, v_buyer, v_price
  from public.bookings b
  join public.listings l on l.id = b.listing_id
  left join public.profiles p on p.id = b.buyer_id
  where b.id = v_id and b.seller_id = new.user_id;
  if found then
    new.title := 'New video call booked';
    new.body := format('%s booked %s for %s tokens. Open the order to see the time, chat, and join link.',
                       v_buyer, v_title, v_price);
  end if;
  return new;
end $$;

drop trigger if exists describe_new_booking_notification on public.notifications;
create trigger describe_new_booking_notification
before insert on public.notifications
for each row execute function public.describe_new_booking_notification();
