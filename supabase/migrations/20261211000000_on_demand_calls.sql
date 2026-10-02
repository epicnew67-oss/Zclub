-- On-demand calls retain a booked slot for historical foreign keys, but no
-- customer-facing availability schedule is required for new purchases.
alter table public.bookings add column if not exists is_on_demand boolean not null default false;
alter table public.seller_profiles add column if not exists last_seen_at timestamptz;

create index if not exists bookings_seller_active_idx
  on public.bookings (seller_id, status) where soft_deleted_at is null;

create or replace function public.seller_heartbeat()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.seller_profiles set last_seen_at = now()
    where user_id = auth.uid() and is_active and soft_deleted_at is null;
end $$;
revoke all on function public.seller_heartbeat() from public, anon;
grant execute on function public.seller_heartbeat() to authenticated;

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

-- On-demand orders have no cancellation cutoff before either person joins.
create or replace function public.cancel_on_demand_booking(_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
  v_actor uuid := auth.uid();
  v_role text;
  v_other uuid;
begin
  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not v_booking.is_on_demand then return jsonb_build_object('ok', false, 'code', 'wrong_type'); end if;
  if v_actor = v_booking.buyer_id then v_role := 'buyer'; v_other := v_booking.seller_id;
  elsif v_actor = v_booking.seller_id then v_role := 'seller'; v_other := v_booking.buyer_id;
  else return jsonb_build_object('ok', false, 'code', 'not_participant'); end if;
  if v_booking.status not in ('paid', 'scheduled') then
    return jsonb_build_object('ok', false, 'code', 'already_finalized');
  end if;
  if v_booking.buyer_joined_at is not null or v_booking.seller_joined_at is not null then
    return jsonb_build_object('ok', false, 'code', 'call_started');
  end if;
  perform public.wallet_credit(v_booking.buyer_id, v_booking.price_tokens,
    'booking_refund'::public.ledger_entry_type, 'booking_refund', v_booking.id,
    format('Full refund for cancelled booking %s', v_booking.id), v_actor);
  update public.bookings set status = 'cancelled', updated_at = now() where id = v_booking.id;
  insert into public.notifications (user_id, type, title, body, link)
    values (v_other, 'booking', 'Booking cancelled',
      'The booking was cancelled and the buyer was refunded in full.',
      '/orders/' || v_booking.id::text);
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_actor, 'booking.cancel', 'booking', v_booking.id,
      jsonb_build_object('role', v_role, 'refund_buyer', v_booking.price_tokens));
  return jsonb_build_object('ok', true, 'role', v_role,
    'refunded_buyer', v_booking.price_tokens, 'released_seller', 0);
end $$;
revoke all on function public.cancel_on_demand_booking(uuid) from public, anon;
grant execute on function public.cancel_on_demand_booking(uuid) to authenticated;

-- The commission is a real owner-wallet ledger credit, not leftover escrow.
alter type public.ledger_entry_type add value if not exists 'platform_commission';
insert into public.settings (key, value) values
  ('commission', '{"pct":10}'::jsonb), ('release_window_hours', '{"hours":0}'::jsonb)
on conflict (key) do update set value = excluded.value;

create or replace function public.release_escrow(_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
  v_owner uuid;
  v_seller_credit integer;
  v_commission integer;
  v_pct integer;
begin
  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_booking.status = 'released' then
    return jsonb_build_object('ok', true, 'booking_id', _booking_id, 'already_released', true);
  end if;
  if exists (select 1 from public.disputes where booking_id = _booking_id and status = 'open') then
    return jsonb_build_object('ok', false, 'code', 'frozen_dispute');
  end if;
  if v_booking.status <> 'completed' then
    return jsonb_build_object('ok', false, 'code', 'wrong_state', 'status', v_booking.status);
  end if;
  if v_booking.live_ended_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_live_ended_at');
  end if;
  select ur.user_id into v_owner from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'owner' and p.soft_deleted_at is null and not p.is_banned
    order by ur.created_at, ur.user_id limit 1;
  if v_owner is null then raise exception 'release_escrow: no active owner wallet'; end if;
  select coalesce((value #>> '{pct}')::integer, 10) into v_pct
    from public.settings where key = 'commission';
  v_pct := coalesce(v_pct, 10);
  if v_pct < 0 or v_pct > 100 then raise exception 'release_escrow: invalid commission'; end if;
  v_commission := floor(v_booking.price_tokens * v_pct / 100.0)::integer;
  v_seller_credit := v_booking.price_tokens - v_commission;
  perform public.wallet_credit(v_booking.seller_id, v_seller_credit,
    'booking_release'::public.ledger_entry_type, 'booking_release', _booking_id,
    format('Call earnings for booking %s', _booking_id), null);
  if v_commission > 0 then
    perform public.wallet_credit(v_owner, v_commission,
      'platform_commission'::public.ledger_entry_type, 'platform_commission', _booking_id,
      format('%s%% commission for booking %s', v_pct, _booking_id), null);
  end if;
  update public.bookings set status = 'released', released_at = now(), updated_at = now()
    where id = _booking_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'booking.release', 'booking', _booking_id,
      jsonb_build_object('price_tokens', v_booking.price_tokens,
        'seller_credit', v_seller_credit, 'commission_pct', v_pct,
        'commission_tokens', v_commission, 'owner_id', v_owner));
  insert into public.notifications (user_id, type, title, body, link)
    values (v_booking.seller_id, 'release', 'Call earnings available',
      format('%s tokens have been added to your wallet.', v_seller_credit),
      '/orders/' || _booking_id::text);
  return jsonb_build_object('ok', true, 'booking_id', _booking_id,
    'seller_credit', v_seller_credit, 'commission_pct', v_pct,
    'commission_tokens', v_commission);
end $$;

create or replace function public.release_completed_booking_immediately()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.release_escrow(new.id);
  end if;
  return new;
end $$;
drop trigger if exists booking_release_immediate on public.bookings;
create trigger booking_release_immediate after update of status on public.bookings
  for each row execute function public.release_completed_booking_immediately();

-- Notify the waiting participant once, after verified LiveKit presence lands.
create or replace function public.notify_call_join()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if old.buyer_joined_at is null and new.buyer_joined_at is not null then
    select display_name into v_name from public.profiles where id = new.buyer_id;
    insert into public.notifications (user_id, type, title, body, link)
      values (new.seller_id, 'booking', coalesce(nullif(v_name, ''), 'Buyer') || ' is in the call',
        'Join now to start your video call.', '/orders/' || new.id::text);
  end if;
  if old.seller_joined_at is null and new.seller_joined_at is not null then
    select display_name into v_name from public.profiles where id = new.seller_id;
    insert into public.notifications (user_id, type, title, body, link)
      values (new.buyer_id, 'booking', coalesce(nullif(v_name, ''), 'Seller') || ' is in the call',
        'Join now to start your video call.', '/orders/' || new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists booking_call_join_notify on public.bookings;
create trigger booking_call_join_notify after update of buyer_joined_at, seller_joined_at
  on public.bookings for each row execute function public.notify_call_join();

create or replace function public.mint_livekit_token(_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_slot public.availability_slots;
  v_url text;
  v_role text;
  v_end timestamptz;
begin
  if v_actor is null then return jsonb_build_object('ok', false, 'code', 'not_participant'); end if;
  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_actor = v_booking.buyer_id then v_role := 'buyer';
  elsif v_actor = v_booking.seller_id then v_role := 'seller';
  else return jsonb_build_object('ok', false, 'code', 'not_participant'); end if;
  if v_booking.status not in ('paid', 'scheduled', 'live') then
    return jsonb_build_object('ok', false, 'code', 'wrong_state', 'status', v_booking.status);
  end if;
  select * into v_slot from public.availability_slots where id = v_booking.slot_id;
  if v_slot.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_booking.is_on_demand then
    -- Four-hour absolute safety limit; no customer-facing scheduled window.
    v_end := v_booking.created_at + interval '4 hours';
  else
    if now() < v_slot.starts_at - interval '5 minutes' then
      return jsonb_build_object('ok', false, 'code', 'too_early',
        'starts_at', v_slot.starts_at, 'opens_at', v_slot.starts_at - interval '5 minutes');
    end if;
    v_end := v_slot.ends_at + interval '60 minutes';
  end if;
  if now() > v_end then
    return jsonb_build_object('ok', false, 'code', 'too_late', 'ends_at', v_end);
  end if;
  select value #>> '{}' into v_url from public.settings where key = 'livekit_url';
  return jsonb_build_object('ok', true, 'booking_id', v_booking.id,
    'room_name', coalesce(v_booking.livekit_room, v_booking.id::text),
    'url', coalesce(v_url, ''), 'ends_at', v_end, 'role', v_role,
    'identity', v_actor, 'is_on_demand', v_booking.is_on_demand);
end $$;
revoke all on function public.mint_livekit_token(uuid) from public, anon;
grant execute on function public.mint_livekit_token(uuid) to authenticated;

-- Instant payout means a buyer must be able to flag trouble during the call.
-- A live dispute freezes the hold before the completion trigger can release it.
create or replace function public.open_dispute(_booking_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_reason text := btrim(_reason);
  v_dispute_id uuid;
begin
  if v_actor is null then return jsonb_build_object('ok', false, 'code', 'not_participant'); end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_short');
  end if;
  if length(v_reason) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_long');
  end if;
  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_actor not in (v_booking.buyer_id, v_booking.seller_id) then
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;
  if v_booking.status = 'released' then
    return jsonb_build_object('ok', false, 'code', 'already_released');
  end if;
  if v_booking.status = 'disputed' then
    return jsonb_build_object('ok', false, 'code', 'already_disputed');
  end if;
  if v_booking.status not in ('live', 'completed') then
    return jsonb_build_object('ok', false, 'code', 'wrong_state', 'status', v_booking.status);
  end if;
  insert into public.disputes (booking_id, opened_by, reason, status)
    values (_booking_id, v_actor, v_reason, 'open') returning id into v_dispute_id;
  update public.bookings set status = 'disputed', dispute_opened_at = now(), updated_at = now()
    where id = _booking_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_actor, 'dispute.open', 'booking', _booking_id,
      jsonb_build_object('reason', v_reason, 'dispute_id', v_dispute_id));
  insert into public.notifications (user_id, type, title, body, link)
    values (case when v_actor = v_booking.buyer_id then v_booking.seller_id else v_booking.buyer_id end,
      'dispute', 'A dispute was opened on this booking', v_reason,
      '/orders/' || _booking_id::text);
  return jsonb_build_object('ok', true, 'dispute_id', v_dispute_id, 'booking_id', _booking_id);
end $$;
revoke all on function public.open_dispute(uuid, text) from public, anon;
grant execute on function public.open_dispute(uuid, text) to authenticated;

-- Dispute resolutions also send their residual commission to the owner.
create or replace function public.credit_resolved_dispute_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_refund integer;
  v_seller integer;
  v_commission integer;
begin
  if old.status <> 'disputed' or new.status <> 'released' then return new; end if;
  select coalesce(sum(le.amount), 0) into v_refund from public.ledger_entries le
    where le.ref_id = new.id and le.ref_type = 'booking_dispute_refund';
  select coalesce(sum(le.amount), 0) into v_seller from public.ledger_entries le
    where le.ref_id = new.id and le.ref_type = 'booking_dispute_release';
  v_commission := new.price_tokens - v_refund - v_seller;
  if v_commission <= 0 then return new; end if;
  select ur.user_id into v_owner from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'owner' and p.soft_deleted_at is null and not p.is_banned
    order by ur.created_at, ur.user_id limit 1;
  if v_owner is null then raise exception 'resolve_dispute: no active owner wallet'; end if;
  perform public.wallet_credit(v_owner, v_commission,
    'platform_commission'::public.ledger_entry_type, 'platform_commission', new.id,
    format('Commission for resolved booking %s', new.id), null);
  return new;
end $$;
drop trigger if exists booking_dispute_commission on public.bookings;
create trigger booking_dispute_commission after update of status on public.bookings
  for each row execute function public.credit_resolved_dispute_commission();

-- Completed calls now become released immediately; support chat-log access
-- must continue to include them under the existing reason/retention rules.
create or replace function public.admin_list_chat_log_bookings()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_days integer := 90;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null or not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_list_chat_log_bookings: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  select coalesce((value #>> '{days}')::integer, 90) into v_days
    from public.settings where key = 'chat_retention_days';
  v_days := coalesce(v_days, 90);
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows from (
    select bk.id as booking_id, li.title as listing_title,
      bp.display_name as buyer_name, sp.display_name as seller_name,
      bk.status as booking_status, bk.live_ended_at,
      coalesce((select max(bm.created_at) from public.booking_messages bm
        join public.booking_chats bc on bc.id = bm.chat_id
        where bc.booking_id = bk.id), bk.live_ended_at) as last_message_at
    from public.bookings bk
      join public.listings li on li.id = bk.listing_id
      join public.profiles bp on bp.id = bk.buyer_id
      join public.profiles sp on sp.id = bk.seller_id
    where bk.status in ('completed','released','disputed','cancelled','seller_no_show')
      and bk.live_ended_at is not null
      and bk.live_ended_at > now() - make_interval(days => v_days)
    order by bk.live_ended_at desc limit 200
  ) t;
  return jsonb_build_object('rows', v_rows, 'retention_days', v_days);
end $$;

create or replace function public.admin_get_chat_log(_booking_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(_reason, ''));
  v_booking public.bookings;
  v_days integer := 90;
  v_chat_id uuid;
  v_messages jsonb := '[]'::jsonb;
begin
  if v_actor is null or not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_get_chat_log: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_short');
  end if;
  select * into v_booking from public.bookings where id = _booking_id;
  if v_booking.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_booking.status not in ('completed','released','disputed','cancelled','seller_no_show') then
    return jsonb_build_object('ok', false, 'code', 'wrong_state', 'status', v_booking.status);
  end if;
  if v_booking.live_ended_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_live_ended_at');
  end if;
  select coalesce((value #>> '{days}')::integer, 90) into v_days
    from public.settings where key = 'chat_retention_days';
  v_days := coalesce(v_days, 90);
  if v_booking.live_ended_at < now() - make_interval(days => v_days) then
    return jsonb_build_object('ok', false, 'code', 'retention_expired', 'retention_days', v_days);
  end if;
  select id into v_chat_id from public.booking_chats where booking_id = _booking_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (v_actor, 'chat_log.view', 'booking', _booking_id,
      jsonb_build_object('reason', v_reason));
  if v_chat_id is not null then
    select coalesce(jsonb_agg(row_to_json(m) order by m.created_at), '[]'::jsonb)
      into v_messages from (
        select id, sender_id, body, created_at from public.booking_messages
        where chat_id = v_chat_id order by created_at asc limit 500
      ) m;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', _booking_id,
    'status', v_booking.status, 'messages', v_messages);
end $$;
