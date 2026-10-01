-- ============================================
-- Post-call money flow (release / dispute / payouts)
-- ============================================

-- 1. Settings (idempotent)
insert into public.settings (key, value) values
  ('commission', jsonb_build_object('pct', 15)),
  ('release_window_hours', jsonb_build_object('hours', 24)),
  ('payout_min_tokens', jsonb_build_object('min', 1000))
on conflict (key) do nothing;

-- 2. Bookings extensions
alter table public.bookings
  add column if not exists released_at timestamptz,
  add column if not exists dispute_opened_at timestamptz;

create index if not exists bookings_status_ended_idx
  on public.bookings (status, live_ended_at);

-- 3. Payout extensions (manual reference finance pastes when marking paid).
alter table public.payout_requests
  add column if not exists payment_reference text;

-- 4. Extend ledger_entry_type with dispute-specific values.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'ledger_entry_type'
      and e.enumlabel = 'booking_dispute_refund'
  ) then
    alter type public.ledger_entry_type add value 'booking_dispute_refund';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'ledger_entry_type'
      and e.enumlabel = 'booking_dispute_release'
  ) then
    alter type public.ledger_entry_type add value 'booking_dispute_release';
  end if;
end $$;

-- ============================================
-- 5. open_dispute(_booking_id, _reason)
--    authenticated. Caller is buyer or seller. Booking must be in
--    `completed` state. Idempotent: if already disputed, returns the
--    existing dispute id. Freezes the escrow (release_escrow refuses).
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

  insert into public.audit_log (actor, action, entity_type, entity_id, details)
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
-- 6. release_escrow(_booking_id)
--    service_role (sweep). Idempotent. Computes commission from settings,
--    credits the seller's wallet with `price * (100-pct) / 100`, marks
--    booking `released`. Refuses if there's an open dispute or the 24h
--    window hasn't elapsed yet.
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
      _booking_id::text,
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
-- 7. resolve_dispute(_booking_id, _outcome, _note, _refund_pct)
--    authenticated; support/finance/owner only. Outcomes:
--      'refund_buyer'  — 100% to buyer, seller gets 0
--      'release_seller' — seller gets price*(100-pct)/100, buyer 0
--      'split'          — buyer gets price*refund_pct/100;
--                          seller gets (price - buyer_credit)*(100-pct)/100
--    Always transitions booking to 'released' and dispute to 'resolved'.
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
      'booking_dispute_refund'::text, _booking_id::text,
      format('Dispute refund for booking %s', _booking_id),
      v_actor
    );
  end if;
  if v_seller_credit > 0 then
    perform public.wallet_credit(
      v_booking.seller_id, v_seller_credit,
      'booking_dispute_release'::public.ledger_entry_type,
      'booking_dispute_release'::text, _booking_id::text,
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
-- 8. request_payout(_amount)
--    authenticated seller. Validates amount >= payout_min_tokens AND
--    amount <= (balance - pending_payouts). No ledger movement; just
--    reserves the slot in `payout_requests`.
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

  v_balance := public.wallet_get_balance(v_actor);
  select coalesce(sum(tokens), 0) into v_pending
    from public.payout_requests
    where seller_id = v_actor and status = 'pending';
  v_available := v_balance - v_pending;
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
-- 9. cancel_payout_request(_id) — seller cancels own pending request.
-- ============================================
create or replace function public.cancel_payout_request(_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.payout_requests;
begin
  if v_actor is null then
    raise exception 'cancel_payout_request: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.payout_requests where id = _id for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.seller_id <> v_actor then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_pending',
      'status', v_req.status
    );
  end if;

  update public.payout_requests
    set status = 'cancelled',
        note = coalesce(note, '') || case when note is null or note = '' then '(cancelled by seller)' else ' (cancelled by seller)' end
    where id = _id;

  return jsonb_build_object('ok', true, 'payout_id', _id);
end;
$$;

grant execute on function public.cancel_payout_request(uuid) to authenticated;

-- ============================================
-- 10. approve_payout(_id) — finance/owner only.
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

  insert into public.audit_log (actor, action, entity_type, entity_id, details)
  values (
    v_actor, 'payout.approve', 'payout_request', _id,
    jsonb_build_object('tokens', v_req.tokens)
  );

  return jsonb_build_object('ok', true, 'payout_id', _id);
end;
$$;

grant execute on function public.approve_payout(uuid) to authenticated;

-- ============================================
-- 11. reject_payout(_id, _note) — finance/owner only.
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

  insert into public.audit_log (actor, action, entity_type, entity_id, details)
  values (
    v_actor, 'payout.reject', 'payout_request', _id,
    jsonb_build_object('tokens', v_req.tokens, 'note', v_note)
  );

  return jsonb_build_object('ok', true, 'payout_id', _id);
end;
$$;

grant execute on function public.reject_payout(uuid, text) to authenticated;

-- ============================================
-- 12. mark_payout_paid(_id, _payment_reference)
--     finance/owner only. Must be approved first. Idempotent on
--     replay. Debits the seller ledger with `ref_type='payout'`,
--     `ref_id=payout.id`.
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
      'payout'::text, _id::text,
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

-- ============================================
-- 13. get_seller_wallet_summary(_user_id)
--     Returns { balance, available, in_escrow, pending_payout,
--              approved_payout, paid_payout } for the seller view.
-- ============================================
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

  return jsonb_build_object(
    'user_id', _user_id,
    'balance', v_balance,
    'in_escrow', v_in_escrow,
    'pending_payout', v_pending,
    'available', v_balance - v_pending,
    'approved_payout', v_approved,
    'paid_payout', v_paid
  );
end;
$$;

grant execute on function public.get_seller_wallet_summary(uuid) to authenticated;

-- ============================================
-- 14. Realtime: payouts + disputes for the queues.
-- ============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'payout_requests'
  ) then
    alter publication supabase_realtime add table public.payout_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'disputes'
  ) then
    alter publication supabase_realtime add table public.disputes;
  end if;
end $$;
