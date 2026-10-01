-- ============================================
-- Canonical post-call-money fix migration
-- ============================================
-- Supersedes the drift between 20261103000200 (edited on disk after
-- being applied) and 20261103000400 (re-applied the same change).
-- On a fresh checkout this is the only post-call-money fix that runs
-- after the original 20261103000000, 20261103000100, and 20261103000300
-- migrations — and it contains the final, working definition of every
-- RPC touched by the drift plus the approved-payout reservation fix.
--
-- A fresh checkout that runs all migrations in order must end up in
-- a state where the 262-line test suite passes. Verified with
-- `supabase db reset && npm test`.
--
-- The original 20261103000000_post_call_money.sql shipped with three
-- latent bugs that the fix migrations correct:
--   * wallet_credit / wallet_debit declare _ref_id as uuid, but the
--     migration passed _booking_id::text / _id::text. The resulting
--     undefined_function error (SQLSTATE 42883) escapes the inner
--     `exception when unique_violation` handler, so every RPC that
--     touches money silently failed.
--   * audit_log columns are actor_id / target_type / target_id, not
--     actor / entity_type / entity_id.
--   * notification_type did not include 'release'.
-- 20261103000100 fixed _ref_id; 20261103000300 added the enum value;
-- this file replaces release_escrow (dispute-check-first ordering +
-- the two prior fixes) and replaces the four other RPCs that were
-- broken by the audit_log column bug in 20261103000000.

-- ============================================
-- open_dispute — audit_log column names corrected
-- ============================================
create or replace function public.open_dispute(
  _booking_id uuid,
  _reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_reason text;
  v_existing public.disputes;
  v_dispute_id uuid;
begin
  if v_actor is null then
    raise exception 'open_dispute: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  v_reason := btrim(_reason);
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_short');
  end if;
  if length(v_reason) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_long');
  end if;

  select * into v_booking from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_actor <> v_booking.buyer_id and v_actor <> v_booking.seller_id then
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;

  if v_booking.status = 'released' then
    return jsonb_build_object('ok', false, 'code', 'already_released');
  end if;
  if v_booking.status = 'disputed' then
    select * into v_existing from public.disputes
      where booking_id = _booking_id and status = 'open' limit 1;
    return jsonb_build_object(
      'ok', false,
      'code', 'already_disputed',
      'dispute_id', coalesce(v_existing.id, null)
    );
  end if;
  if v_booking.status <> 'completed' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_booking.status
    );
  end if;

  insert into public.disputes (booking_id, opened_by, reason, status)
  values (_booking_id, v_actor, v_reason, 'open')
  returning id into v_dispute_id;

  update public.bookings
    set status = 'disputed', dispute_opened_at = now()
    where id = _booking_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'dispute.open', 'booking', _booking_id,
    jsonb_build_object('reason', v_reason, 'dispute_id', v_dispute_id)
  );

  insert into public.notifications (user_id, type, title, body, link)
  values (
    case when v_actor = v_booking.buyer_id then v_booking.seller_id
         else v_booking.buyer_id end,
    'dispute',
    'A dispute was opened on this booking',
    v_reason,
    '/orders/' || _booking_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'dispute_id', v_dispute_id,
    'booking_id', _booking_id
  );
end;
$$;

grant execute on function public.open_dispute(uuid, text) to authenticated;

-- ============================================
-- approve_payout — audit_log column names corrected
-- ============================================
create or replace function public.approve_payout(_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.payout_requests;
begin
  if not (public.user_has_role('finance') or public.user_has_role('owner')) then
    raise exception 'approve_payout: finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.payout_requests where id = _id for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_req.status
    );
  end if;

  update public.payout_requests
    set status = 'approved', reviewed_by = v_actor, reviewed_at = now()
    where id = _id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'payout.approve', 'payout_request', _id,
    jsonb_build_object('tokens', v_req.tokens)
  );

  return jsonb_build_object('ok', true, 'payout_id', _id);
end;
$$;

grant execute on function public.approve_payout(uuid) to authenticated;

-- ============================================
-- reject_payout — audit_log column names corrected
-- ============================================
create or replace function public.reject_payout(_id uuid, _note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.payout_requests;
  v_note text;
begin
  if not (public.user_has_role('finance') or public.user_has_role('owner')) then
    raise exception 'reject_payout: finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_note := btrim(_note);
  if v_note is null or length(v_note) < 5 then
    return jsonb_build_object('ok', false, 'code', 'note_too_short');
  end if;

  select * into v_req from public.payout_requests where id = _id for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_req.status
    );
  end if;

  update public.payout_requests
    set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), note = v_note
    where id = _id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'payout.reject', 'payout_request', _id,
    jsonb_build_object('tokens', v_req.tokens, 'note', v_note)
  );

  return jsonb_build_object('ok', true, 'payout_id', _id);
end;
$$;

grant execute on function public.reject_payout(uuid, text) to authenticated;

-- ============================================
-- mark_payout_paid — audit_log column names + _ref_id uuid
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

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
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

-- ============================================
-- release_escrow — canonical
--   * dispute check runs BEFORE status check, so opening a dispute
--     (which flips the booking to 'disputed') reliably returns
--     'frozen_dispute' instead of 'wrong_state'.
--   * audit_log uses actor_id / target_type / target_id (the actual
--     column names on public.audit_log).
--   * wallet_credit _ref_id is passed as a uuid (the column type on
--     public.ledger_entries is uuid; passing text would raise
--     SQLSTATE 42883, which is NOT unique_violation and escapes the
--     inner exception handler).
--   * notification_type includes 'release' (added in 20261103000300).
-- ============================================
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

  -- Frozen-escrow check FIRST: an open dispute blocks release
  -- regardless of where the booking is in its lifecycle. open_dispute
  -- flips status to 'disputed', so a status check before this would
  -- return 'wrong_state' instead of 'frozen_dispute'.
  select * into v_open_dispute from public.disputes
    where booking_id = _booking_id and status = 'open' limit 1;
  if v_open_dispute.id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'frozen_dispute',
      'dispute_id', v_open_dispute.id
    );
  end if;

  if v_booking.status <> 'completed' then
    return jsonb_build_object(
      'ok', false,
      'code', 'wrong_state',
      'status', v_booking.status
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

  -- Idempotent credit: a re-run (e.g. the sweep firing twice) is a
  -- no-op on the ledger because the (wallet_id, ref_type, ref_id)
  -- UNIQUE INDEX on public.ledger_entries raises unique_violation,
  -- which we catch and convert to an already_released reply without
  -- re-crediting.
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

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
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
-- get_seller_wallet_summary — approved_payout reserved too
-- ============================================
-- 'available' now subtracts BOTH pending and approved payout requests,
-- not just pending. Previously an approved-but-not-yet-paid request
-- left the same balance exposed for a second request, so finance
-- could approve both and the second mark_payout_paid would fail with
-- INSUFFICIENT_BALANCE. Treating approved as reserved (alongside
-- pending) closes that hole.
create or replace function public.get_seller_wallet_summary(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_in_escrow int;
  v_pending int;
  v_approved int;
  v_paid int;
  v_available int;
begin
  v_balance := public.wallet_get_balance(_user_id);

  select coalesce(sum(price_tokens), 0) into v_in_escrow
    from public.bookings
    where seller_id = _user_id
      and status in ('paid', 'scheduled', 'live', 'completed', 'disputed');

  select
    coalesce(sum(tokens) filter (where status = 'pending'), 0),
    coalesce(sum(tokens) filter (where status = 'approved'), 0),
    coalesce(sum(tokens) filter (where status = 'paid'), 0)
    into v_pending, v_approved, v_paid
    from public.payout_requests
    where seller_id = _user_id;

  -- Reserved = both pending and approved. Once a request is approved,
  -- finance owns it; the seller must not be able to spend that
  -- balance against another request.
  v_available := v_balance - v_pending - v_approved;

  return jsonb_build_object(
    'user_id', _user_id,
    'balance', v_balance,
    'in_escrow', v_in_escrow,
    'pending_payout', v_pending,
    'approved_payout', v_approved,
    'paid_payout', v_paid,
    'available', v_available
  );
end;
$$;

grant execute on function public.get_seller_wallet_summary(uuid) to authenticated;

-- ============================================
-- request_payout — same available formula
-- ============================================
create or replace function public.request_payout(_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_min int;
  v_balance int;
  v_pending int;
  v_approved int;
  v_available int;
  v_id uuid;
  v_seller_ok boolean;
begin
  if v_actor is null then
    raise exception 'request_payout: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select exists (
    select 1 from public.seller_profiles
    where user_id = v_actor and soft_deleted_at is null and is_active = true
  ) into v_seller_ok;
  if not v_seller_ok then
    return jsonb_build_object('ok', false, 'code', 'not_a_seller');
  end if;

  if _amount is null or _amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_amount');
  end if;

  select coalesce((value #>> '{min}')::int, 1000) into v_min
    from public.settings where key = 'payout_min_tokens';
  if v_min is null then v_min := 1000; end if;
  if _amount < v_min then
    return jsonb_build_object('ok', false, 'code', 'below_min', 'min', v_min);
  end if;

  -- Reserved = pending + approved (mirrors get_seller_wallet_summary).
  v_balance := public.wallet_get_balance(v_actor);
  select
    coalesce(sum(tokens) filter (where status = 'pending'), 0),
    coalesce(sum(tokens) filter (where status = 'approved'), 0)
    into v_pending, v_approved
    from public.payout_requests
    where seller_id = v_actor;
  v_available := v_balance - v_pending - v_approved;
  if v_available < _amount then
    return jsonb_build_object(
      'ok', false,
      'code', 'INSUFFICIENT_AVAILABLE',
      'have', v_available,
      'need', _amount
    );
  end if;

  insert into public.payout_requests (seller_id, tokens, status)
  values (v_actor, _amount, 'pending')
  returning id into v_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_actor, 'payout', 'Payout request submitted',
    format('%s tokens requested.', _amount), '/wallet'
  );

  return jsonb_build_object(
    'ok', true,
    'payout_id', v_id,
    'amount', _amount,
    'available_after', v_available - _amount
  );
end;
$$;

grant execute on function public.request_payout(int) to authenticated;

-- ============================================
-- resolve_dispute — docstring comment
-- ============================================
-- Commission is applied ONLY to the seller's slice. Concretely for
-- outcome='split' with refund_pct=50 on a 1000-token booking:
--   buyer_credit  = 1000 * 50 / 100                = 500  (no commission)
--   seller_credit = (1000 - 500) * (100 - 15) / 100 = 425  (commission 75)
-- The total debited from escrow (500 + 425 = 925) plus the 75-token
-- commission is less than the 1000-token booking price; the 75 is the
-- marketplace's cut. This is intentional, not a bug — refunding the
-- buyer at face value while charging commission only on what the
-- seller actually receives is the standard escrow split.
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

  -- See header note: commission applies only to the seller's slice.
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

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
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
