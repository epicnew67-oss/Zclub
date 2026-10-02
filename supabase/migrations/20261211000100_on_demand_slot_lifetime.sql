-- Align the synthetic on-demand slot with the four-hour LiveKit safety limit.
-- The slot is an internal foreign-key record, not a customer-facing schedule.
update public.availability_slots as slot
set ends_at = greatest(slot.ends_at, booking.created_at + interval '4 hours')
from public.bookings as booking
where booking.slot_id = slot.id
  and booking.is_on_demand
  and booking.status in ('paid', 'scheduled', 'live');

create or replace function public.purchase_listing_now(_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_buyer uuid := auth.uid();
  v_listing public.listings;
  v_seller public.seller_profiles;
  v_slot_id uuid;
  v_booking_id uuid;
  v_chat_id uuid;
  v_balance integer;
begin
  if v_buyer is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;
  select * into v_listing from public.listings where id = _listing_id;
  if v_listing.id is null or v_listing.status <> 'approved'
     or not v_listing.is_active or v_listing.soft_deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'listing_unavailable');
  end if;

  -- A seller row lock serializes competing purchases across all listings.
  select * into v_seller from public.seller_profiles
    where id = v_listing.seller_id for update;
  if v_seller.id is null or not v_seller.is_active
     or v_seller.soft_deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'listing_unavailable');
  end if;
  if v_seller.user_id = v_buyer then
    return jsonb_build_object('ok', false, 'code', 'cannot_self_book');
  end if;
  if v_seller.last_seen_at is null or v_seller.last_seen_at < now() - interval '90 seconds' then
    return jsonb_build_object('ok', false, 'code', 'seller_offline');
  end if;
  if exists (select 1 from public.bookings
             where seller_id = v_seller.user_id and status in ('paid', 'scheduled', 'live')
               and soft_deleted_at is null
               and (is_on_demand or status = 'live')) then
    return jsonb_build_object('ok', false, 'code', 'seller_busy');
  end if;
  v_balance := public.wallet_get_balance(v_buyer);
  if v_balance < v_listing.price_tokens then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
      'have', v_balance, 'need', v_listing.price_tokens,
      'shortfall', v_listing.price_tokens - v_balance);
  end if;

  insert into public.availability_slots (listing_id, starts_at, ends_at, price_tokens, status)
    values (v_listing.id, now(), now() + interval '4 hours',
      v_listing.price_tokens, 'booked') returning id into v_slot_id;
  insert into public.bookings (buyer_id, seller_id, listing_id, slot_id,
    price_tokens, status, is_on_demand)
    values (v_buyer, v_seller.user_id, v_listing.id, v_slot_id,
      v_listing.price_tokens, 'paid', true) returning id into v_booking_id;
  insert into public.booking_chats (booking_id) values (v_booking_id)
    returning id into v_chat_id;
  perform public.wallet_debit(v_buyer, v_listing.price_tokens,
    'booking_hold'::public.ledger_entry_type, 'booking_hold', v_booking_id,
    format('Hold for booking %s', v_booking_id), v_buyer);
  insert into public.notifications (user_id, type, title, body, link)
    values (v_seller.user_id, 'booking', 'New call booking',
      'A buyer booked your call. Join now.', '/orders/' || v_booking_id::text);
  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'chat_id', v_chat_id);
end $$;
revoke all on function public.purchase_listing_now(uuid) from public, anon;
grant execute on function public.purchase_listing_now(uuid) to authenticated;
