-- StripClub — top-ups: NOWPayments crypto (webhook-credited, idempotent)
-- + JazzCash/Easypaisa manual submissions (finance-approved).
--
-- Money rules honored here:
--   * Ledger crediting happens ONLY inside the RPCs below, each a single
--     DB transaction, each idempotent by (wallet_id, ref_type, ref_id) —
--     the same external payment ID can never credit twice.
--   * No stored balance anywhere (balance = sum of ledger).
--   * Role checks (finance/owner) happen inside the RPCs, server-side.

-- ============================================================ enums / columns

create type public.topup_method as enum ('crypto', 'jazzcash', 'easypaisa');

alter table public.topup_requests
  alter column payment_id drop not null,
  alter column transaction_id drop not null,
  add column method public.topup_method not null default 'crypto',
  add column token_pack_id uuid references public.token_packs(id),
  add column reference_code text,
  add column sender_number text,
  add column screenshot_path text,
  add column expires_at timestamptz,
  add column reviewed_by uuid references public.profiles(id),
  add column review_note text,
  add column reviewed_at timestamptz;

-- Reference codes identify a manual payment on bank statements.
create unique index topups_reference_code_unique
  on public.topup_requests (reference_code)
  where reference_code is not null;

create index topups_queue_idx on public.topup_requests (status, created_at);

alter table public.payments
  add column price_usd numeric(18, 2),
  add column rate_lock jsonb,
  add column actually_paid numeric(18, 8),
  add column needs_review boolean not null default false,
  add column flag_reason text;

-- Live updates for the buyer's status page (own rows only, via RLS).
alter publication supabase_realtime add table public.topup_requests;
alter publication supabase_realtime add table public.payments;

-- ============================================================ storage: screenshots

insert into storage.buckets (id, name, public)
values ('topup-screenshots', 'topup-screenshots', false)
on conflict (id) do nothing;

-- Buyers upload into their own folder: topup-screenshots/<uid>/…
create policy "topup_screenshots_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'topup-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Buyers can view their own uploads; finance/support/owner can review.
create policy "topup_screenshots_select_own_or_finance"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'topup-screenshots'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.user_has_role('finance'::public.user_role)
      or public.user_has_role('support'::public.user_role)
      or public.user_has_role('owner'::public.user_role)
    )
  );

-- ============================================================ settings

insert into public.settings (key, value) values
  ('jazzcash',
   jsonb_build_object('account_number', '0300-0000000',
                      'account_name', 'StripClub Payments',
                      'qr_data_url', null)),
  ('easypaisa',
   jsonb_build_object('account_number', '0301-0000001',
                      'account_name', 'StripClub Payments',
                      'qr_data_url', null)),
  ('payment_rates',
   jsonb_build_object('usd_per_pkr', 0.0036, 'crypto_min_usd', 1.5))
on conflict (key) do nothing;

-- ============================================================ webhook RPC
-- One transaction per IPN. Credits ONLY on 'finished'. Overpaid credits the
-- pack exactly once and flags for finance; underpaid/partial goes to manual
-- review; replays are no-ops. Service-role only (called by the webhook
-- route after the HMAC signature verifies).

create or replace function public.nowpayments_webhook_apply(
  _payment_id text,
  _ipn_status text,
  _actually_paid numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_topup_id uuid;
  v_topup_status public.topup_status;
  v_overpaid boolean;
  v_paid numeric;
begin
  select * into v_payment
  from public.payments
  where external_id = _payment_id
  for update;

  if v_payment.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_payment');
  end if;

  select id, status into v_topup_id, v_topup_status
  from public.topup_requests
  where payment_id = v_payment.id
  limit 1;

  if _ipn_status = 'finished' then
    if v_topup_id is not null and v_topup_status = 'completed' then
      update public.payments
      set actually_paid = coalesce(_actually_paid, actually_paid),
          status = 'confirmed', updated_at = now()
      where id = v_payment.id;
      return jsonb_build_object('ok', true, 'credited', false,
                                'reason', 'already_completed');
    end if;

    v_overpaid :=
      coalesce(_actually_paid, v_payment.pay_amount) > v_payment.pay_amount;

    -- Credit exactly once: idempotent by (wallet, 'payment', payment.id).
    insert into public.ledger_entries (
      wallet_id, entry_type, amount, ref_type, ref_id, description
    )
    select w.id, 'topup', v_payment.tokens, 'payment', v_payment.id,
           'Crypto top-up (NOWPayments ' || v_payment.external_id || ')'
    from public.wallets w
    where w.user_id = v_payment.user_id
    on conflict (wallet_id, ref_type, ref_id)
      where ref_type is not null and ref_id is not null
    do nothing;

    update public.payments
    set status = 'confirmed',
        actually_paid = coalesce(_actually_paid, actually_paid),
        needs_review = v_overpaid,
        flag_reason = case when v_overpaid
          then 'overpaid — pack tokens credited, difference flagged'
          else flag_reason end,
        updated_at = now()
    where id = v_payment.id;

    if v_topup_id is not null then
      update public.topup_requests
      set status = 'completed', processed_at = now()
      where id = v_topup_id;
    end if;

    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'topup.webhook_credit', 'payment', v_payment.id,
            jsonb_build_object('method', 'crypto', 'tokens', v_payment.tokens,
                               'actually_paid', _actually_paid,
                               'overpaid', v_overpaid));

    return jsonb_build_object('ok', true, 'credited', true,
                              'overpaid', v_overpaid);
  end if;

  if _ipn_status = 'partially_paid' then
    update public.payments
    set actually_paid = coalesce(_actually_paid, actually_paid),
        needs_review = true,
        flag_reason = 'underpaid — manual review required',
        updated_at = now()
    where id = v_payment.id;
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'topup.flag_underpaid', 'payment', v_payment.id,
            jsonb_build_object('actually_paid', _actually_paid));
    return jsonb_build_object('ok', true, 'credited', false,
                              'reason', 'underpaid_flagged');
  end if;

  if _ipn_status = 'expired' then
    v_paid := coalesce(_actually_paid, 0);
    if v_paid > 0 then
      update public.payments
      set status = 'expired', actually_paid = v_paid, needs_review = true,
          flag_reason = 'underpaid — expired with partial payment',
          updated_at = now()
      where id = v_payment.id;
      insert into public.audit_log (actor_id, action, target_type, target_id, details)
      values (null, 'topup.flag_underpaid', 'payment', v_payment.id,
              jsonb_build_object('actually_paid', v_paid, 'expired', true));
      return jsonb_build_object('ok', true, 'credited', false,
                                'reason', 'underpaid_expired_flagged');
    end if;
    update public.payments
    set status = 'expired', updated_at = now()
    where id = v_payment.id;
    if v_topup_id is not null then
      update public.topup_requests
      set status = 'expired', processed_at = now()
      where id = v_topup_id;
    end if;
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'topup.expired', 'payment', v_payment.id,
            jsonb_build_object('actually_paid', 0));
    return jsonb_build_object('ok', true, 'credited', false,
                              'reason', 'expired');
  end if;

  if _ipn_status = 'failed' then
    update public.payments
    set status = 'failed', updated_at = now()
    where id = v_payment.id;
    if v_topup_id is not null and v_topup_status = 'pending' then
      update public.topup_requests
      set status = 'failed', processed_at = now()
      where id = v_topup_id;
    end if;
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'topup.failed', 'payment', v_payment.id,
            jsonb_build_object('ipn_status', 'failed'));
    return jsonb_build_object('ok', true, 'credited', false,
                              'reason', 'failed');
  end if;

  if _ipn_status = 'refunded' then
    update public.payments
    set needs_review = true,
        flag_reason = 'refunded after payment — manual review',
        updated_at = now()
    where id = v_payment.id;
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'topup.flag_refunded', 'payment', v_payment.id,
            jsonb_build_object('ipn_status', 'refunded'));
    return jsonb_build_object('ok', true, 'credited', false,
                              'reason', 'refunded_flagged');
  end if;

  -- waiting / confirming / confirmed / sending — tracking only.
  update public.payments
  set actually_paid = coalesce(_actually_paid, actually_paid),
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object('ok', true, 'credited', false,
                            'reason', 'tracking');
end $$;

revoke all on function public.nowpayments_webhook_apply(text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.nowpayments_webhook_apply(text, text, numeric)
  to service_role;

-- ============================================================ finance RPCs
-- Approve credits the ledger exactly once (idempotent), resolves the
-- top-up + payment, and writes the audit log — all in one transaction.
-- finance/owner only, checked server-side via auth.uid().

create or replace function public.finance_approve_topup(
  _topup_id uuid,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_topup public.topup_requests;
begin
  if v_reviewer is null then
    raise exception 'finance_approve_topup: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'finance_approve_topup: finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_topup
  from public.topup_requests
  where id = _topup_id
  for update;

  if v_topup.id is null then
    raise exception 'finance_approve_topup: top-up % not found', _topup_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_topup.status <> 'pending' then
    raise exception 'finance_approve_topup: top-up already %', v_topup.status
      using errcode = 'check_violation';
  end if;
  if v_topup.method <> 'crypto'
     and v_topup.expires_at is not null
     and v_topup.expires_at < now() then
    raise exception
      'finance_approve_topup: the 30-minute manual payment window has expired'
      using errcode = 'check_violation';
  end if;

  -- Credit exactly once: idempotent by (wallet, 'topup', topup.id).
  insert into public.ledger_entries (
    wallet_id, entry_type, amount, ref_type, ref_id, description, created_by
  )
  select w.id, 'topup', v_topup.tokens, 'topup', v_topup.id,
         'Top-up approved (' || v_topup.method || ')', v_reviewer
  from public.wallets w
  where w.user_id = v_topup.user_id
  on conflict (wallet_id, ref_type, ref_id)
    where ref_type is not null and ref_id is not null
  do nothing;

  update public.topup_requests
  set status = 'completed',
      processed_at = now(),
      reviewed_by = v_reviewer,
      review_note = _note,
      reviewed_at = now()
  where id = v_topup.id;

  -- Resolve a flagged crypto payment, if any.
  update public.payments p
  set needs_review = false, flag_reason = null, status = 'confirmed',
      updated_at = now()
  where p.id = v_topup.payment_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'topup.approve', 'topup_request', v_topup.id,
          jsonb_build_object('method', v_topup.method, 'tokens', v_topup.tokens,
                             'note', _note));

  return jsonb_build_object(
    'ok', true,
    'balance', public.wallet_get_balance(v_topup.user_id)
  );
end $$;

revoke all on function public.finance_approve_topup(uuid, text)
  from public, anon;
grant execute on function public.finance_approve_topup(uuid, text)
  to authenticated;

create or replace function public.finance_reject_topup(
  _topup_id uuid,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_topup public.topup_requests;
begin
  if v_reviewer is null then
    raise exception 'finance_reject_topup: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'finance_reject_topup: finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_topup
  from public.topup_requests
  where id = _topup_id
  for update;

  if v_topup.id is null then
    raise exception 'finance_reject_topup: top-up % not found', _topup_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_topup.status <> 'pending' then
    raise exception 'finance_reject_topup: top-up already %', v_topup.status
      using errcode = 'check_violation';
  end if;

  update public.topup_requests
  set status = 'failed',
      processed_at = now(),
      reviewed_by = v_reviewer,
      review_note = _reason,
      reviewed_at = now()
  where id = v_topup.id;

  update public.payments p
  set status = 'failed', updated_at = now()
  where p.id = v_topup.payment_id and p.status <> 'confirmed';

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'topup.reject', 'topup_request', v_topup.id,
          jsonb_build_object('method', v_topup.method, 'reason', _reason));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.finance_reject_topup(uuid, text)
  from public, anon;
grant execute on function public.finance_reject_topup(uuid, text)
  to authenticated;
