-- StripClub — purchasing flow: bookings, chat, cancellation, no-show.
--
-- Every money-moving RPC runs in a single transaction, returns a
-- structured jsonb result, and writes the matching ledger triple
-- (booking_hold / booking_release / booking_refund). The wallet RPCs
-- already do locked, idempotent writes; we just compose them.
--
-- RLS stays the gate. The Phase 2 `booking_messages_insert_own` policy
-- would let participants bypass rate-limiting and HTML sanitization, so
-- this migration drops it: every chat write goes through the
-- `send_chat_message` RPC.

-- ============================================================ helpers

-- Read a JSONB settings row. Returns null when missing.
create or replace function public.get_setting(_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.settings where key = _key
$$;

grant execute on function public.get_setting(text) to authenticated;
grant execute on function public.get_setting(text) to service_role;

-- ============================================================ settings

insert into public.settings (key, value) values
  ('cancellation_policy',
    jsonb_build_object(
      'buyer_full_refund_hours', 24,
      'buyer_partial_refund_pct', 50
    )),
  ('no_show_grace_minutes',
    jsonb_build_object('minutes', 10)),
  ('chat_rate_limit',
    jsonb_build_object('max_per_minute', 20))
on conflict (key) do nothing;

-- ============================================================ realtime
--
-- Wrap each ALTER in a DO block so re-running the migration on a stack
-- that already has the table in the publication is a no-op rather than
-- a fatal error (which would abort the rest of the migration).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_chats'
  ) then
    alter publication supabase_realtime add table public.booking_chats;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_messages'
  ) then
    alter publication supabase_realtime add table public.booking_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================ indexes

create index if not exists bookings_status_slot_idx
  on public.bookings (status, slot_id);

create index if not exists booking_messages_chat_recent_idx
  on public.booking_messages (chat_id, sender_id, created_at desc);

-- ============================================================ RLS: chat writes via RPC only

-- Phase 2 allowed participants to INSERT into booking_messages directly.
-- That bypasses our rate limit + HTML sanitization. Drop the policy and
-- route everything through send_chat_message.
drop policy if exists "booking_messages_insert_own" on public.booking_messages;

-- ============================================================ RPC: purchase_slot

create or replace function public.purchase_slot(_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_slot public.availability_slots;
  v_listing public.listings;
  v_seller_user_id uuid;
  v_seller_profile_id uuid;
  v_booking_id uuid;
  v_chat_id uuid;
  v_price integer;
  v_balance integer;
  v_shortfall integer;
begin
  if v_buyer is null then
    raise exception 'purchase_slot: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Lock the slot row so concurrent purchases serialize on it.
  select * into v_slot
  from public.availability_slots
  where id = _slot_id
  for update;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'slot_not_found');
  end if;
  -- If the slot is no longer open, it might be because the other race
  -- winner just took it. Distinguish "booked by another buyer" (return
  -- slot_already_taken) from a genuine admin-close (slot_not_open).
  if v_slot.status <> 'open' then
    if exists (select 1 from public.bookings where slot_id = _slot_id) then
      return jsonb_build_object('ok', false, 'code', 'slot_already_taken');
    end if;
    return jsonb_build_object('ok', false, 'code', 'slot_not_open');
  end if;
  if v_slot.ends_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'slot_in_past');
  end if;

  -- Listing + seller.
  select * into v_listing from public.listings where id = v_slot.listing_id;
  if v_listing.id is null or v_listing.soft_deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'listing_unavailable');
  end if;
  if v_listing.status <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'listing_unavailable');
  end if;

  select sp.id, sp.user_id into v_seller_profile_id, v_seller_user_id
  from public.seller_profiles sp
  where sp.id = v_listing.seller_id;
  if v_seller_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'listing_unavailable');
  end if;
  if v_seller_user_id = v_buyer then
    return jsonb_build_object('ok', false, 'code', 'cannot_self_book');
  end if;

  v_price := v_slot.price_tokens;

  -- Authoritative balance under the wallet row lock from wallet_debit.
  v_balance := public.wallet_get_balance(v_buyer);
  if v_balance < v_price then
    return jsonb_build_object(
      'ok', false,
      'code', 'INSUFFICIENT_BALANCE',
      'have', v_balance,
      'need', v_price,
      'shortfall', v_price - v_balance
    );
  end if;

  -- Insert the booking. The UNIQUE(bookings.slot_id) constraint is the
  -- source of truth for double-booking races.
  begin
    insert into public.bookings (buyer_id, seller_id, listing_id, slot_id, price_tokens, status)
    values (v_buyer, v_seller_user_id, v_listing.id, v_slot.id, v_price, 'paid')
    returning id into v_booking_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'slot_already_taken');
  end;

  -- One chat per booking (unique constraint enforces).
  insert into public.booking_chats (booking_id) values (v_booking_id)
  returning id into v_chat_id;

  -- Mark slot booked.
  update public.availability_slots set status = 'booked' where id = v_slot.id;

  -- Debit the buyer. wallet_debit is locked + idempotent; replay returns
  -- the original entry without inserting a second row.
  -- Use a distinct ref_type from the eventual refund/release so the
  -- wallet's (wallet_id, ref_type, ref_id) unique index doesn't collide.
  begin
    perform 1 from public.wallet_debit(
      v_buyer, v_price, 'booking_hold'::public.ledger_entry_type,
      'booking_hold'::text, v_booking_id,
      format('Hold for booking %s', v_booking_id),
      v_buyer
    );
  exception when check_violation then
    -- Concurrent spend lowered the balance below price between our read
    -- and the locked debit. Surface a clean error.
    v_balance := public.wallet_get_balance(v_buyer);
    if v_balance < v_price then
      v_shortfall := v_price - v_balance;
      raise exception 'INSUFFICIENT_BALANCE have=%, need=%, shortfall=%',
        v_balance, v_price, v_shortfall
        using errcode = 'P0001';
    end if;
    raise;
  end;

  -- Notify the seller.
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_seller_user_id, 'booking',
    'New booking', format('Tokens held for booking %s', v_booking_id),
    format('/orders/%s', v_booking_id)
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'chat_id', v_chat_id
  );
end $$;

revoke all on function public.purchase_slot(uuid) from public, anon;
grant execute on function public.purchase_slot(uuid) to authenticated;
grant execute on function public.purchase_slot(uuid) to service_role;

-- ============================================================ RPC: cancel_booking

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

  -- The call has already begun (or is in the past). Refuse — the
  -- no-show sweep handles missed-seller cases.
  if v_slot.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'too_late');
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
    if v_hours_before >= v_full_hours then
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

  update public.availability_slots set status = 'open' where id = v_slot.id;

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

-- ============================================================ RPC: mark_no_show_refund

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

-- ============================================================ RPC: send_chat_message

create or replace function public.send_chat_message(
  _chat_id uuid,
  _body text
)
returns public.booking_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_chat public.booking_chats;
  v_booking public.bookings;
  v_clean text;
  v_max integer;
  v_count integer;
  v_msg public.booking_messages;
begin
  if v_sender is null then
    raise exception 'send_chat_message: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if _body is null or btrim(_body) = '' then
    raise exception 'send_chat_message: empty body'
      using errcode = 'check_violation';
  end if;

  select * into v_chat from public.booking_chats where id = _chat_id;
  if v_chat.id is null then
    raise exception 'send_chat_message: chat not found'
      using errcode = 'foreign_key_violation';
  end if;

  select * into v_booking from public.bookings where id = v_chat.booking_id;
  if v_sender <> v_booking.buyer_id and v_sender <> v_booking.seller_id then
    raise exception 'send_chat_message: not a participant'
      using errcode = 'insufficient_privilege';
  end if;

  -- Rate limit per sender in this chat.
  v_max := coalesce(
    ((public.get_setting('chat_rate_limit')::jsonb)->>'max_per_minute')::integer,
    20);
  select count(*) into v_count
  from public.booking_messages
  where chat_id = _chat_id
    and sender_id = v_sender
    and created_at > now() - interval '1 minute';
  if v_count >= v_max then
    raise exception 'send_chat_message: rate_limited (max=% per minute)', v_max
      using errcode = 'check_violation';
  end if;

  -- Sanitize: strip simple HTML tags.
  v_clean := regexp_replace(btrim(_body), '<[^>]*>', '', 'g');
  if v_clean = '' then
    raise exception 'send_chat_message: empty body after sanitization'
      using errcode = 'check_violation';
  end if;

  insert into public.booking_messages (chat_id, sender_id, body)
  values (_chat_id, v_sender, v_clean)
  returning * into v_msg;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    case when v_sender = v_booking.buyer_id then v_booking.seller_id
         else v_booking.buyer_id end,
    'chat',
    'New message',
    substring(v_clean, 1, 120),
    format('/orders/%s', v_booking.id)
  );

  return v_msg;
end $$;

revoke all on function public.send_chat_message(uuid, text) from public, anon;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
