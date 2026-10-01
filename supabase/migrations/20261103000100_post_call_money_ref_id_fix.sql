-- ============================================
-- Post-call money flow: fix wallet_credit/debit _ref_id type
-- ============================================
-- The previous migration passed `_booking_id::text` / `_id::text` to
-- `wallet_credit` / `wallet_debit` whose `_ref_id` parameter is `uuid`.
-- The `function does not exist` error is SQLSTATE 42883 (undefined_function),
-- which is NOT caught by `exception when unique_violation`, so the whole
-- RPC bubbled out with an error and `data` came back null. Every caller
-- (release_escrow, resolve_dispute, mark_payout_paid) was silently
-- failing on every code path that touches money.
--
-- Fix: pass the uuid directly. Recreate the four RPC bodies.

create or replace function public.release_escrow(_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_pct int;
  v_hours int;
  v_seller_credit int;
  v_open_dispute public.disputes;
  v_release_at timestamptz;
  v_window_hours_interval interval;
begin
  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Idempotent: already released.
  if v_booking.status = 'released' then
    return jsonb_build_object(
      'ok', true,
      'booking_id', _booking_id,
      'already_released', true
    );
  end if;
  if v_booking.status <> 'completed' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_booking.status
    );
  end if;

  select * into v_open_dispute from public.disputes
    where booking_id = _booking_id and status = 'open' limit 1;
  if v_open_dispute.id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'frozen_dispute',
      'dispute_id', v_open_dispute.id
    );
  end if;

  if v_booking.live_ended_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_live_ended_at');
  end if;

  select coalesce((value #>> '{pct}')::int, 15) into v_pct
    from public.settings where key = 'commission';
  if v_pct is null then v_pct := 15; end if;
  select coalesce((value #>> '{hours}')::int, 24) into v_hours
    from public.settings where key = 'release_window_hours';
  if v_hours is null then v_hours := 24; end if;
  v_window_hours_interval := (v_hours::text || ' hours')::interval;

  v_release_at := v_booking.live_ended_at + v_window_hours_interval;
  if now() < v_release_at then
    return jsonb_build_object(
      'ok', false,
      'code', 'window_not_elapsed',
      'releasable_at', v_release_at
    );
  end if;

  v_seller_credit := (v_booking.price_tokens * (100 - v_pct)) / 100;

  -- Idempotent credit: if a release row already exists, no-op.
  begin
    perform public.wallet_credit(
      v_booking.seller_id,
      v_seller_credit,
      'booking_release'::public.ledger_entry_type,
      'booking_release'::text,
      _booking_id,
      format('Release for booking %s', _booking_id),
      null
    );
  exception when unique_violation then
    update public.bookings
      set status = 'released', released_at = coalesce(released_at, now())
      where id = _booking_id;
    return jsonb_build_object(
      'ok', true,
      'booking_id', _booking_id,
      'already_released', true
    );
  end;

  update public.bookings
    set status = 'released', released_at = now()
    where id = _booking_id;

  insert into public.audit_log (actor, action, entity_type, entity_id, details)
  values (
    null, 'booking.release', 'booking', _booking_id,
    jsonb_build_object(
      'price_tokens', v_booking.price_tokens,
      'commission_pct', v_pct,
      'seller_credit', v_seller_credit,
      'commission_tokens', v_booking.price_tokens - v_seller_credit
    )
  );

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_booking.seller_id,
    'release',
    'Booking escrow released',
    format('You received %s tokens (commission: %s%%).', v_seller_credit, v_pct),
    '/orders/' || _booking_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'seller_credit', v_seller_credit,
    'commission_pct', v_pct,
    'commission_tokens', v_booking.price_tokens - v_seller_credit
  );
end;
$$;

grant execute on function public.release_escrow(uuid) to service_role;

-- ============================================
-- resolve_dispute — fix _ref_id for buyer + seller credits
-- ============================================

create or replace function public.resolve_dispute(
  _booking_id uuid,
  _outcome text,
  _note text,
  _refund_pct int default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_pct int;
  v_dispute public.disputes;
  v_buyer_credit int := 0;
  v_seller_credit int := 0;
  v_note text;
begin
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'resolve_dispute: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_note := btrim(_note);
  if v_note is null or length(v_note) < 5 then
    return jsonb_build_object('ok', false, 'code', 'note_too_short');
  end if;

  if _outcome not in ('refund_buyer', 'release_seller', 'split') then
    return jsonb_build_object('ok', false, 'code', 'bad_outcome');
  end if;

  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_booking.status <> 'disputed' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_booking.status
    );
  end if;

  select * into v_dispute from public.disputes
    where booking_id = _booking_id and status = 'open' limit 1;
  if v_dispute.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_open_dispute');
  end if;

  select coalesce((value #>> '{pct}')::int, 15) into v_pct
    from public.settings where key = 'commission';
  if v_pct is null then v_pct := 15; end if;

  if _outcome = 'refund_buyer' then
    v_buyer_credit := v_booking.price_tokens;
    v_seller_credit := 0;
  elsif _outcome = 'release_seller' then
    v_buyer_credit := 0;
    v_seller_credit := (v_booking.price_tokens * (100 - v_pct)) / 100;
  else
    if _refund_pct is null or _refund_pct < 0 or _refund_pct > 100 then
      return jsonb_build_object('ok', false, 'code', 'bad_refund_pct');
    end if;
    v_buyer_credit := (v_booking.price_tokens * _refund_pct) / 100;
    v_seller_credit := ((v_booking.price_tokens - v_buyer_credit) * (100 - v_pct)) / 100;
  end if;

  if v_buyer_credit > 0 then
    perform public.wallet_credit(
      v_booking.buyer_id, v_buyer_credit,
      'booking_dispute_refund'::public.ledger_entry_type,
      'booking_dispute_refund'::text, _booking_id,
      format('Dispute refund for booking %s', _booking_id),
      v_actor
    );
  end if;
  if v_seller_credit > 0 then
    perform public.wallet_credit(
      v_booking.seller_id, v_seller_credit,
      'booking_dispute_release'::public.ledger_entry_type,
      'booking_dispute_release'::text, _booking_id,
      format('Dispute release for booking %s', _booking_id),
      v_actor
    );
  end if;

  update public.disputes
    set status = 'resolved',
        resolution_note = v_note,
        resolved_by = v_actor,
        resolved_at = now()
    where id = v_dispute.id;

  update public.bookings
    set status = 'released', released_at = now()
    where id = _booking_id;

  insert into public.audit_log (actor, action, entity_type, entity_id, details)
  values (
    v_actor, 'dispute.resolve', 'booking', _booking_id,
    jsonb_build_object(
      'outcome', _outcome,
      'refund_pct', _refund_pct,
      'note', v_note,
      'buyer_credit', v_buyer_credit,
      'seller_credit', v_seller_credit,
      'commission_pct', v_pct,
      'dispute_id', v_dispute.id
    )
  );

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_booking.buyer_id, 'dispute', 'Dispute resolved',
    format('Outcome: %s. %s', _outcome, v_note), '/orders/' || _booking_id::text
  );
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_booking.seller_id, 'dispute', 'Dispute resolved',
    format('Outcome: %s. %s', _outcome, v_note), '/orders/' || _booking_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'outcome', _outcome,
    'buyer_credit', v_buyer_credit,
    'seller_credit', v_seller_credit,
    'commission_pct', v_pct,
    'dispute_id', v_dispute.id
  );
end;
$$;

grant execute on function public.resolve_dispute(uuid, text, text, int) to authenticated;

-- ============================================
-- mark_payout_paid — fix _ref_id for the seller debit
-- ============================================

create or replace function public.mark_payout_paid(
  _id uuid,
  _payment_reference text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.payout_requests;
  v_ref text;
begin
  if not (public.user_has_role('finance') or public.user_has_role('owner')) then
    raise exception 'mark_payout_paid: finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_ref := btrim(_payment_reference);
  if v_ref is null or length(v_ref) < 1 then
    return jsonb_build_object('ok', false, 'code', 'reference_required');
  end if;

  select * into v_req from public.payout_requests where id = _id for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_req.status = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'payout_id', _id,
      'already_paid', true,
      'payment_reference', v_req.payment_reference
    );
  end if;
  if v_req.status <> 'approved' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_req.status
    );
  end if;

  begin
    perform public.wallet_debit(
      v_req.seller_id, v_req.tokens,
      'payout'::public.ledger_entry_type,
      'payout'::text, _id,
      format('Payout %s', _id),
      v_actor
    );
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE');
  end;

  update public.payout_requests
    set status = 'paid', processed_at = now(), payment_reference = v_ref
    where id = _id;

  insert into public.audit_log (actor, action, entity_type, entity_id, details)
  values (
    v_actor, 'payout.paid', 'payout_request', _id,
    jsonb_build_object('tokens', v_req.tokens, 'payment_reference', v_ref)
  );

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_req.seller_id, 'payout', 'Payout completed',
    format('%s tokens paid. Reference: %s', v_req.tokens, v_ref),
    '/wallet'
  );

  return jsonb_build_object(
    'ok', true,
    'payout_id', _id,
    'tokens', v_req.tokens,
    'payment_reference', v_ref
  );
end;
$$;

grant execute on function public.mark_payout_paid(uuid, text) to authenticated;
