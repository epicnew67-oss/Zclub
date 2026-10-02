-- Cancel a booked call that never started, including after its scheduled start.
-- Financial changes, booking state and audit remain one database transaction.
create or replace function public.cancel_booking(_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_slot public.availability_slots;
  v_role text;
  v_hours_before numeric;
  v_refund_buyer integer := 0;
  v_release_seller integer := 0;
  v_full_hours integer;
  v_partial_pct integer;
  v_other_user uuid;
begin
  if v_actor is null then
    raise exception 'cancel_booking: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Lock the booking row so two concurrent cancels serialize.
  select * into v_booking
  from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_actor = v_booking.buyer_id then
    v_role := 'buyer';
    v_other_user := v_booking.seller_id;
  elsif v_actor = v_booking.seller_id then
    v_role := 'seller';
    v_other_user := v_booking.buyer_id;
  else
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;

  if v_booking.status not in ('paid', 'scheduled') then
    return jsonb_build_object('ok', false, 'code', 'already_finalized',
      'status', v_booking.status);
  end if;

  select * into v_slot from public.availability_slots where id = v_booking.slot_id;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- A scheduled start is not evidence that a call took place. Keep the
  -- cancellation path open while nobody has joined. The booking lock also
  -- serializes with LiveKit webhooks and the no-show sweep.
  if v_booking.buyer_joined_at is not null or
     v_booking.seller_joined_at is not null or
     v_booking.live_started_at is not null then
    return jsonb_build_object('ok', false, 'code', 'call_started');
  end if;

  -- Settings.
  v_full_hours := coalesce(
    ((public.get_setting('cancellation_policy')::jsonb)
      ->>'buyer_full_refund_hours')::integer,
    24);
  v_partial_pct := coalesce(
    ((public.get_setting('cancellation_policy')::jsonb)
      ->>'buyer_partial_refund_pct')::integer,
    50);

  v_hours_before := extract(epoch from (v_slot.starts_at - now())) / 3600.0;

  if v_role = 'buyer' then
    if v_slot.starts_at <= now() or v_hours_before >= v_full_hours then
      v_refund_buyer := v_booking.price_tokens;
      v_release_seller := 0;
    else
      -- Partial: buyer gets partial_pct%, seller gets the rest as comp.
      v_refund_buyer := floor(v_booking.price_tokens * v_partial_pct / 100.0)::integer;
      v_release_seller := v_booking.price_tokens - v_refund_buyer;
    end if;
  else
    -- Seller cancels anytime: full refund to buyer, seller absorbs loss.
    v_refund_buyer := v_booking.price_tokens;
    v_release_seller := 0;
  end if;

  -- Apply credits. wallet_credit is idempotent on (ref_type, ref_id);
  -- each operation uses a distinct ref_type so holds and refunds for the
  -- same booking don't collide on the wallet's unique index.
  if v_refund_buyer > 0 then
    perform 1 from public.wallet_credit(
      v_booking.buyer_id, v_refund_buyer, 'booking_refund'::public.ledger_entry_type,
      'booking_refund'::text, v_booking.id,
      format('Refund for cancelled booking %s (%s)', v_booking.id, v_role),
      v_actor
    );
  end if;
  if v_release_seller > 0 then
    perform 1 from public.wallet_credit(
      v_booking.seller_id, v_release_seller, 'booking_release'::public.ledger_entry_type,
      'booking_release'::text, v_booking.id,
      format('Compensation for late buyer cancel on booking %s', v_booking.id),
      v_actor
    );
  end if;

  update public.bookings
    set status = 'cancelled', updated_at = now()
    where id = v_booking.id;

  -- Never advertise an elapsed slot again.
  if v_slot.starts_at > now() then
    update public.availability_slots set status = 'open' where id = v_slot.id;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_other_user, 'booking',
    'Booking cancelled',
    format('%s cancelled booking %s — refunded %s tokens',
      v_role, v_booking.id, v_refund_buyer::text),
    format('/orders/%s', v_booking.id)
  );

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'booking.cancel', 'booking', v_booking.id,
    jsonb_build_object(
      'role', v_role,
      'refund_buyer', v_refund_buyer,
      'release_seller', v_release_seller,
      'slot_id', v_slot.id,
      'slot_starts_at', v_slot.starts_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'refunded_buyer', v_refund_buyer,
    'released_seller', v_release_seller
  );
end $$;

revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;
