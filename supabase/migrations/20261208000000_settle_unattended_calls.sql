-- Keep buyer no-show protection when the buyer joined but the seller did not.
-- Ignore late LiveKit join events for finalized bookings.
create or replace function public.mark_no_show_refund(_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_slot public.availability_slots;
  v_grace_minutes integer;
begin
  v_grace_minutes := coalesce(
    ((public.get_setting('no_show_grace_minutes')::jsonb)->>'minutes')::integer,
    10);

  select * into v_booking
  from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Idempotent: already refunded.
  if v_booking.status = 'seller_no_show' then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  -- If the seller ever connected, they did show up — leave the row
  -- alone and let the caller decide what to do.
  if v_booking.seller_joined_at is not null then
    return jsonb_build_object('ok', false, 'code', 'seller_joined');
  end if;

  if v_booking.status not in ('paid', 'scheduled', 'live') then
    return jsonb_build_object('ok', false, 'code', 'already_finalized',
      'status', v_booking.status);
  end if;

  select * into v_slot from public.availability_slots where id = v_booking.slot_id;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_slot.starts_at > now() - (v_grace_minutes::text || ' minutes')::interval then
    return jsonb_build_object('ok', false, 'code', 'too_early');
  end if;

  -- Full refund to buyer.
  perform 1 from public.wallet_credit(
    v_booking.buyer_id, v_booking.price_tokens,
    'booking_refund'::public.ledger_entry_type,
    'booking_no_show_refund'::text, v_booking.id,
    format('Seller no-show refund for booking %s', v_booking.id),
    null
  );

  update public.bookings
    set status = 'seller_no_show', updated_at = now()
    where id = v_booking.id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_booking.buyer_id, 'booking',
    'Seller no-show — refunded',
    format('You were refunded %s tokens for booking %s',
      v_booking.price_tokens::text, v_booking.id::text),
    format('/orders/%s', v_booking.id)
  ),
  (
    v_booking.seller_id, 'booking',
    'Marked as no-show',
    format('Booking %s was marked seller no-show and the buyer was refunded.',
      v_booking.id::text),
    format('/orders/%s', v_booking.id)
  );

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    null, 'booking.no_show', 'booking', v_booking.id,
    jsonb_build_object(
      'slot_id', v_slot.id,
      'slot_starts_at', v_slot.starts_at,
      'grace_minutes', v_grace_minutes,
      'refund_buyer', v_booking.price_tokens
    )
  );

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mark_no_show_refund(uuid) from public, anon, authenticated;
grant execute on function public.mark_no_show_refund(uuid) to service_role;

create or replace function public.livekit_webhook_apply(
  _booking_id uuid,
  _event_type text,
  _user_id uuid,
  _at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_now timestamptz := coalesce(_at, now());
begin
  select * into v_booking
  from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if _event_type = 'participant_joined' then
    if v_booking.status not in ('paid', 'scheduled', 'live') then
      return jsonb_build_object('ok', false, 'code', 'wrong_state', 'status', v_booking.status);
    end if;
    if _user_id = v_booking.buyer_id then
      -- Idempotent: only stamp on the first join.
      if v_booking.buyer_joined_at is null then
        update public.bookings
          set buyer_joined_at = v_now, updated_at = v_now
          where id = v_booking.id;
      end if;
    elsif _user_id = v_booking.seller_id then
      if v_booking.seller_joined_at is null then
        update public.bookings
          set seller_joined_at = v_now, updated_at = v_now
          where id = v_booking.id;
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'unknown_participant');
    end if;

    -- First join by either side moves the booking to live.
    if v_booking.status in ('paid', 'scheduled') then
      update public.bookings
        set status = 'live', live_started_at = coalesce(v_booking.live_started_at, v_now),
            updated_at = v_now
        where id = v_booking.id;
    end if;

  elsif _event_type = 'participant_left' then
    if _user_id = v_booking.buyer_id then
      update public.bookings set buyer_left_at = v_now, updated_at = v_now where id = v_booking.id;
    elsif _user_id = v_booking.seller_id then
      update public.bookings set seller_left_at = v_now, updated_at = v_now where id = v_booking.id;
    else
      return jsonb_build_object('ok', false, 'code', 'unknown_participant');
    end if;

  elsif _event_type = 'room_finished' then
    -- A buyer alone in the room is still owed a seller no-show refund.
    -- Only the seller showing up makes the call eligible for completion.
    if v_booking.status = 'live' and v_booking.seller_joined_at is not null then
      update public.bookings
        set status = 'completed', live_ended_at = v_now, updated_at = v_now
        where id = v_booking.id;
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'unknown_event', 'event', _event_type);
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.livekit_webhook_apply(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.livekit_webhook_apply(uuid, text, uuid, timestamptz)
  to service_role;

-- Process refunds and releases inside Postgres. The per-booking RPCs hold row
-- locks, enforce their own eligibility, and remain idempotent under retries.
create extension if not exists pg_cron with schema extensions;

-- Existing bookings predate reliable call presence tracking and need manual review.
insert into public.settings (key, value) values
  ('settlement_cutover', to_jsonb(now()))
on conflict (key) do nothing;

create or replace function public.settle_due_bookings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_no_show_minutes integer;
  v_release_hours integer;
  v_cutover timestamptz;
begin
  v_no_show_minutes := coalesce(
    ((public.get_setting('no_show_grace_minutes')::jsonb)->>'minutes')::integer, 10);
  v_release_hours := coalesce(
    ((public.get_setting('release_window_hours')::jsonb)->>'hours')::integer, 24);
  select (value #>> '{}')::timestamptz into v_cutover
    from public.settings where key = 'settlement_cutover';
  v_cutover := coalesce(v_cutover, now());

  for v_booking in
    select b.id from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status in ('paid', 'scheduled', 'live')
      and b.created_at >= v_cutover
      and b.seller_joined_at is null
      and s.starts_at <= now() - make_interval(mins => v_no_show_minutes)
    order by s.starts_at
    limit 200
  loop
    perform public.mark_no_show_refund(v_booking.id);
  end loop;

  for v_booking in
    select b.id from public.bookings b
    where b.status = 'completed'
      and b.created_at >= v_cutover
      and b.live_ended_at <= now() - make_interval(hours => v_release_hours)
    order by b.live_ended_at
    limit 200
  loop
    perform public.release_escrow(v_booking.id);
  end loop;
end $$;

revoke all on function public.settle_due_bookings() from public, anon, authenticated;
grant execute on function public.settle_due_bookings() to service_role;

select cron.schedule('zclub-booking-settlement', '*/5 * * * *',
  'select public.settle_due_bookings()');
