-- Atomic cancellation and terminal payment state protection.
create or replace function public.nowpayments_webhook_apply(
  _payment_id text,
  _ipn_status text,
  _actually_paid numeric default null,
  _actually_paid_fiat numeric default null
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

  -- Provider notifications and polling responses can arrive out of order.
  -- A credited payment is terminal; only an explicit refund may flag it.
  if v_payment.status = 'confirmed' and _ipn_status <> 'refunded' then
    return jsonb_build_object('ok', true, 'credited', false,
      'reason', 'already_completed');
  end if;

  -- Keep display state inside this transaction/row lock, too. Do not
  -- resurrect a buyer-cancelled checkout when an old waiting poll arrives.
  if not (v_payment.pay_status = 'cancelled' and _ipn_status = 'waiting') then
    update public.payments set pay_status = _ipn_status where id = v_payment.id;
  end if;

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
      case
        when _actually_paid_fiat is not null and v_payment.price_usd is not null
          then _actually_paid_fiat > v_payment.price_usd
        when _actually_paid is not null and v_payment.pay_amount is not null
          then _actually_paid > v_payment.pay_amount
        else false
      end;

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
                               'actually_paid_at_fiat', _actually_paid_fiat,
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

revoke all on function public.nowpayments_webhook_apply(text, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.nowpayments_webhook_apply(text, text, numeric, numeric)
  to service_role;

create or replace function public.cancel_crypto_topup(_topup_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_topup public.topup_requests;
  v_payment public.payments;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_topup from public.topup_requests
    where id = _topup_id and user_id = auth.uid();
  if v_topup.id is null or v_topup.method <> 'crypto' or v_topup.payment_id is null then
    return jsonb_build_object('ok', false, 'error', 'Crypto top-up not found.');
  end if;

  -- Match the webhook's lock order: payment first, then top-up.
  select * into v_payment from public.payments where id = v_topup.payment_id for update;
  select * into v_topup from public.topup_requests where id = _topup_id for update;
  if v_payment.id is null or v_payment.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Crypto top-up not found.');
  end if;
  if v_topup.status <> 'pending' or v_payment.status <> 'pending'
     or coalesce(v_payment.pay_status, 'waiting') not in ('waiting', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'This payment is no longer awaiting payment. Refresh its status.');
  end if;
  update public.topup_requests set status = 'expired', processed_at = now(),
    review_note = 'Cancelled by the buyer' where id = _topup_id;
  update public.payments set pay_status = 'cancelled', updated_at = now()
    where id = v_payment.id;
  insert into public.audit_log(actor_id, action, target_type, target_id, details)
    values(auth.uid(), 'topup.cancel', 'payment', v_payment.id,
      jsonb_build_object('topup_id', _topup_id));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cancel_crypto_topup(uuid) from public, anon;
grant execute on function public.cancel_crypto_topup(uuid) to authenticated;
