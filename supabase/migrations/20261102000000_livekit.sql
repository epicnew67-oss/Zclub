-- StripClub — LiveKit video call: token minting + webhook state updates +
-- no-show sweep upgrade to honour seller_joined_at.
--
-- Token minting and webhook apply are SECURITY DEFINER RPCs (one DB
-- transaction each) so all auth + state changes go through Postgres.
-- The actual LiveKit JWT is minted server-side in /src/lib/livekit.ts
-- using the API secret read from env (never from a DB setting) — the
-- RPC only validates + returns the room name + ends_at.

-- ============================================================ columns

alter table public.bookings
  add column if not exists buyer_joined_at timestamptz,
  add column if not exists seller_joined_at timestamptz,
  add column if not exists buyer_left_at timestamptz,
  add column if not exists seller_left_at timestamptz,
  add column if not exists live_started_at timestamptz,
  add column if not exists live_ended_at timestamptz;

-- ============================================================ indexes

-- Sweep + admin views filter on (status, seller_joined_at) for the
-- no-show case ("paid, started > 10m ago, seller never joined").
create index if not exists bookings_status_joined_idx
  on public.bookings (status, seller_joined_at, live_started_at);

-- ============================================================ settings

-- The LiveKit URL can live in settings (not secret). The API key +
-- secret + webhook secret are env-only and never reach the DB.
insert into public.settings (key, value) values
  ('livekit_url', to_jsonb('wss://stripclub-dghrhg0h.livekit.cloud'::text))
on conflict (key) do nothing;

-- ============================================================ sweep upgrade

-- The existing mark_no_show_refund is updated to consider seller_joined_at:
-- if the seller ever connected to the room, they showed up. The sweep
-- only fires when (status IN (paid, scheduled)) AND slot started >
-- no_show_grace_minutes ago AND seller_joined_at IS NULL. Re-applying
-- the bookings migration first re-creates the function; this migration
-- drops and replaces it again with the upgraded check. If the function
-- signature changes in a future migration, drop+create here too.
drop function if exists public.mark_no_show_refund(uuid);

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

  if v_booking.status not in ('paid', 'scheduled') then
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

-- ============================================================ RPC: mint_livekit_token

-- Validates caller (auth.uid) is buyer or seller on the booking, that
-- the booking is in (paid, scheduled, live), and that we are inside the
-- join window (5 min before slot.starts_at through slot.ends_at). On
-- success returns the room name + ends_at + the caller's role so the
-- server route can mint the LiveKit JWT using the API secret (env).
create or replace function public.mint_livekit_token(_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_slot public.availability_slots;
  v_url text;
  v_role text;
begin
  if v_actor is null then
    raise exception 'mint_livekit_token: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_booking
  from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_actor = v_booking.buyer_id then
    v_role := 'buyer';
  elsif v_actor = v_booking.seller_id then
    v_role := 'seller';
  else
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;

  if v_booking.status not in ('paid', 'scheduled', 'live') then
    return jsonb_build_object('ok', false, 'code', 'wrong_state',
      'status', v_booking.status);
  end if;

  select * into v_slot from public.availability_slots where id = v_booking.slot_id;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if now() < v_slot.starts_at - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'too_early',
      'starts_at', v_slot.starts_at,
      'opens_at', v_slot.starts_at - interval '5 minutes');
  end if;
  if now() > v_slot.ends_at then
    return jsonb_build_object('ok', false, 'code', 'too_late');
  end if;

  select value #>>'{}' into v_url from public.settings where key = 'livekit_url';

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'room_name', coalesce(v_booking.livekit_room, v_booking.id::text),
    'url', coalesce(v_url, ''),
    'ends_at', v_slot.ends_at,
    'role', v_role,
    'identity', v_actor
  );
end $$;

revoke all on function public.mint_livekit_token(uuid) from public, anon;
grant execute on function public.mint_livekit_token(uuid) to authenticated;

-- ============================================================ RPC: livekit_webhook_apply

-- Service-role only. Called by the /api/webhooks/livekit route handler
-- after signature verification. Each event_type is idempotent:
--   participant_joined: sets the per-participant joined_at (only on the
--     first join; subsequent joins are no-ops). If status is currently
--     paid/scheduled, transitions to 'live' and stamps live_started_at.
--   participant_left: stamps the per-participant left_at (every leave).
--   room_finished: transitions live -> completed and stamps
--     live_ended_at. (Both-left detection: LiveKit sends room_finished
--     when the last participant disconnects.)
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
    if v_booking.status = 'live' then
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