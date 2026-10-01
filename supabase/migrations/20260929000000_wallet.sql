-- StripClub — wallet system: idempotent credit / debit / balance RPCs.
--
-- The ledger is append-only. There is no stored balance anywhere;
-- balance = sum(ledger_entries) for a wallet. Every money change goes
-- through one of these RPCs, which run in a single transaction with
-- the wallet row locked (FOR UPDATE), so concurrent debits can't
-- overdraw.
--
-- Idempotency: every call MUST supply ref_type + ref_id. The pair
-- (wallet_id, ref_type, ref_id) is unique — replaying the same
-- external payment / hold / payout twice returns the original entry
-- instead of inserting a second one.
--
-- These functions are security definer and granted to service_role
-- only. Clients must not call them directly — server code uses the
-- service-role key. This keeps money writes out of the client trust
-- boundary entirely.

-- ============================================================ idempotency index

create unique index if not exists ledger_idempotency_unique
  on public.ledger_entries (wallet_id, ref_type, ref_id)
  where ref_type is not null and ref_id is not null;

-- ============================================================ wallet_get_balance

create or replace function public.wallet_get_balance(_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(le.amount), 0)::integer
  from public.ledger_entries le
  join public.wallets w on w.id = le.wallet_id
  where w.user_id = _user_id
$$;
revoke all on function public.wallet_get_balance(uuid) from public, anon, authenticated;
grant execute on function public.wallet_get_balance(uuid) to service_role;

-- ============================================================ wallet_credit

create or replace function public.wallet_credit(
  _user_id uuid,
  _amount integer,
  _entry_type public.ledger_entry_type,
  _ref_type text,
  _ref_id uuid,
  _description text default null,
  _created_by uuid default null
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_entry public.ledger_entries;
begin
  if _amount is null or _amount <= 0 then
    raise exception 'wallet_credit: amount must be a positive integer (got %)',
      _amount using errcode = 'check_violation';
  end if;
  if _ref_type is null or _ref_id is null then
    raise exception 'wallet_credit: ref_type and ref_id are required (idempotency key)'
      using errcode = 'check_violation';
  end if;

  -- Lock the wallet row so this credit serializes against concurrent
  -- debits on the same wallet.
  select id into v_wallet_id
  from public.wallets
  where user_id = _user_id
  for update;

  if v_wallet_id is null then
    raise exception 'wallet_credit: no wallet for user %', _user_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Idempotent insert: if (wallet_id, ref_type, ref_id) already exists,
  -- return the original row instead of inserting a second credit.
  begin
    insert into public.ledger_entries (
      wallet_id, entry_type, amount, ref_type, ref_id, description, created_by
    ) values (
      v_wallet_id, _entry_type, _amount, _ref_type, _ref_id, _description, _created_by
    )
    returning * into v_entry;
  exception when unique_violation then
    select * into v_entry
    from public.ledger_entries
    where wallet_id = v_wallet_id
      and ref_type = _ref_type
      and ref_id = _ref_id;
  end;

  return v_entry;
end $$;

revoke all on function public.wallet_credit(
  uuid, integer, public.ledger_entry_type, text, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.wallet_credit(
  uuid, integer, public.ledger_entry_type, text, uuid, text, uuid
) to service_role;

-- ============================================================ wallet_debit

create or replace function public.wallet_debit(
  _user_id uuid,
  _amount integer,
  _entry_type public.ledger_entry_type,
  _ref_type text,
  _ref_id uuid,
  _description text default null,
  _created_by uuid default null
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_balance integer;
  v_entry public.ledger_entries;
begin
  if _amount is null or _amount <= 0 then
    raise exception 'wallet_debit: amount must be a positive integer (got %)',
      _amount using errcode = 'check_violation';
  end if;
  if _ref_type is null or _ref_id is null then
    raise exception 'wallet_debit: ref_type and ref_id are required (idempotency key)'
      using errcode = 'check_violation';
  end if;

  -- Lock the wallet row first — this serializes ALL writes for this
  -- user (credits and debits). Concurrent debits on the same wallet
  -- block here until the first transaction commits or aborts.
  select id into v_wallet_id
  from public.wallets
  where user_id = _user_id
  for update;

  if v_wallet_id is null then
    raise exception 'wallet_debit: no wallet for user %', _user_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Idempotent replay: if this exact (ref_type, ref_id) was already
  -- recorded, return the original entry and skip the debit.
  select * into v_entry
  from public.ledger_entries
  where wallet_id = v_wallet_id
    and ref_type = _ref_type
    and ref_id = _ref_id;

  if found then
    return v_entry;
  end if;

  -- Authoritative balance under the row lock: sum of all prior entries.
  select coalesce(sum(amount), 0)::integer into v_balance
  from public.ledger_entries
  where wallet_id = v_wallet_id;

  if v_balance < _amount then
    raise exception 'wallet_debit: insufficient balance (have %, need %)',
      v_balance, _amount using errcode = 'check_violation';
  end if;

  insert into public.ledger_entries (
    wallet_id, entry_type, amount, ref_type, ref_id, description, created_by
  ) values (
    v_wallet_id, _entry_type, -_amount, _ref_type, _ref_id, _description, _created_by
  )
  returning * into v_entry;

  return v_entry;
end $$;

revoke all on function public.wallet_debit(
  uuid, integer, public.ledger_entry_type, text, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.wallet_debit(
  uuid, integer, public.ledger_entry_type, text, uuid, text, uuid
) to service_role;

-- ============================================================ realtime

-- Wallet balance and ledger view updates depend on push notifications
-- from ledger_entries. The append-only triggers stay in place; RLS
-- limits each subscriber to their own wallet's rows.
alter publication supabase_realtime add table public.ledger_entries;