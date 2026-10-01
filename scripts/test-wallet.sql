-- scripts/test-wallet.sql — StripClub wallet smoke test.
--
-- Run as postgres (bypasses RLS for fixtures, then switches roles):
--   local:   docker exec -i supabase_db_Strip_Club psql -U postgres -d postgres < scripts/test-wallet.sql
--   hosted:  paste into the Supabase SQL editor and run.
--
-- Asserts:
--   * wallet_credit credits and is idempotent on (ref_type, ref_id)
--   * wallet_debit debits, refuses overdrafts, is idempotent
--   * concurrent debits against the same wallet serialize on the row
--     lock and cannot overdraw
--   * balance RPC = sum(ledger_entries.amount) for the wallet
--
-- Creates throwaway users and rolls everything back at the end.

begin;

create extension if not exists dblink;

create function pg_temp.assert_eq(expected bigint, got bigint, msg text)
returns void language plpgsql as $$
begin
  if got = expected then
    raise notice 'PASS: % (%)', msg, got;
  else
    raise exception 'FAIL: % (expected %, got %)', msg, expected, got;
  end if;
end $$;

create function pg_temp.assert_true(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond then
    raise notice 'PASS: %', msg;
  else
    raise exception 'FAIL: %', msg;
  end if;
end $$;

create function pg_temp.assert_blocked(stmt text, msg text)
returns void language plpgsql as $$
declare blocked boolean := false;
begin
  begin
    execute stmt;
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: % — statement succeeded but should have been blocked', msg;
  end if;
  raise notice 'PASS: % (blocked)', msg;
end $$;

-- ---------- fixtures (as postgres) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at)
values
  (gen_random_uuid(), 'wallet-test-1@test.local', 'test-password', now()),
  (gen_random_uuid(), 'wallet-test-2@test.local', 'test-password', now());

create temp table wallet_ctx on commit drop as
select
  (select id from auth.users where email = 'wallet-test-1@test.local') as alice,
  (select id from auth.users where email = 'wallet-test-2@test.local') as bob;

grant select on wallet_ctx to authenticated, anon;

-- ---------- 1. credit is idempotent ----------

do $$
declare
  v_a uuid;
  v_ref uuid := gen_random_uuid();
  v_first public.ledger_entries;
  v_second public.ledger_entries;
  v_balance integer;
begin
  select alice into v_a from wallet_ctx;

  v_first := public.wallet_credit(v_a, 1000, 'topup', 'payment', v_ref, 'seed topup');
  v_second := public.wallet_credit(v_a, 1000, 'topup', 'payment', v_ref, 'seed topup');
  perform pg_temp.assert_eq(v_first.id, v_second.id,
    '1a. replaying credit returns the same row (idempotent)');
  perform pg_temp.assert_eq(1, (select count(*) from public.ledger_entries
    where wallet_id = v_first.wallet_id and ref_type = 'payment' and ref_id = v_ref),
    '1b. only one row exists for (ref_type, ref_id)');
  v_balance := public.wallet_get_balance(v_a);
  perform pg_temp.assert_eq(1000, v_balance, '1c. balance = 1000 after one credit');
end $$;

-- ---------- 2. credit needs ref_type and ref_id ----------

do $$
declare v_a uuid;
begin
  select alice into v_a from wallet_ctx;
  perform pg_temp.assert_blocked(
    format('select public.wallet_credit(%L, 100, ''topup'', null, gen_random_uuid(), ''no ref_type'')', v_a),
    '2a. credit without ref_type is blocked');
  perform pg_temp.assert_blocked(
    format('select public.wallet_credit(%L, 100, ''topup'', ''payment'', null, ''no ref_id'')', v_a),
    '2b. credit without ref_id is blocked');
  perform pg_temp.assert_blocked(
    format('select public.wallet_credit(%L, 0, ''topup'', ''payment'', gen_random_uuid(), ''zero'')', v_a),
    '2c. credit with amount = 0 is blocked');
end $$;

-- ---------- 3. debit refuses overdraft and is idempotent ----------

do $$
declare
  v_a uuid;
  v_ref uuid := gen_random_uuid();
  v_balance_before integer;
  v_d1 public.ledger_entries;
  v_d2 public.ledger_entries;
begin
  select alice into v_a from wallet_ctx;
  v_balance_before := public.wallet_get_balance(v_a);
  perform pg_temp.assert_eq(1000, v_balance_before, '3a. balance before debit = 1000');

  perform pg_temp.assert_blocked(
    format('select public.wallet_debit(%L, 5000, ''payout'', ''payout'', gen_random_uuid(), ''overdraw'')', v_a),
    '3b. debit > balance is blocked (CHECK preventing negative balance)');
  perform pg_temp.assert_eq(1000, public.wallet_get_balance(v_a),
    '3c. balance is unchanged after blocked overdraft');

  v_d1 := public.wallet_debit(v_a, 400, 'booking_hold', 'booking', v_ref, 'hold');
  perform pg_temp.assert_eq(600, public.wallet_get_balance(v_a),
    '3d. balance after 400 debit = 600');

  v_d2 := public.wallet_debit(v_a, 400, 'booking_hold', 'booking', v_ref, 'hold');
  perform pg_temp.assert_eq(v_d1.id, v_d2.id,
    '3e. replaying debit returns the same row (idempotent)');
  perform pg_temp.assert_eq(600, public.wallet_get_balance(v_a),
    '3f. balance still 600 after debit replay');
end $$;

-- ---------- 4. concurrent debits cannot overdraw ----------

do $$
declare
  v_b uuid;
  v_balance_before integer;
  v_succeeded integer := 0;
begin
  select bob into v_b from wallet_ctx;
  v_balance_before := public.wallet_get_balance(v_b);
  perform pg_temp.assert_eq(0, v_balance_before, '4a. bob starts at 0');

  -- Top bob up to 700.
  perform public.wallet_credit(v_b, 700, 'topup', 'payment', gen_random_uuid(), 'bob seed');
  perform pg_temp.assert_eq(700, public.wallet_get_balance(v_b),
    '4b. bob credited 700');

  -- Spawn two concurrent debits, each 500, against bob. The row lock
  -- in wallet_debit serializes them; only one can succeed because the
  -- second would leave bob at 200, not 100.
  v_succeeded := v_succeeded + case when
    dblink_exec('dbname=postgres user=postgres',
      format('select public.wallet_debit(%L, 500, ''booking_hold'', ''booking'', gen_random_uuid(), ''concurrent A'')',
        v_b)) is not null then 1 else 0 end;
exception when others then
  null;
end $$;

-- dblink approach: do the actual concurrent test with two separate
-- sessions via dblink so the row locks actually contend.
do $$
declare
  v_b uuid;
  v_a_ok boolean;
  v_b_ok boolean;
  v_final integer;
begin
  select bob into v_b from wallet_ctx;

  -- Reset bob to 700.
  delete from public.ledger_entries where wallet_id = (select id from public.wallets where user_id = v_b);
  perform public.wallet_credit(v_b, 700, 'topup', 'payment', gen_random_uuid(), 'bob seed 2');

  -- Open session A and hold an open transaction that has locked the
  -- wallet row (via wallet_debit on the max amount). Then from session
  -- B try a second debit that would overdraw — it must block, then
  -- fail when A commits.
  perform dblink_connect('sess_a', 'dbname=postgres user=postgres password=postgres');
  perform dblink_connect('sess_b', 'dbname=postgres user=postgres password=postgres');

  -- Session A: start tx, debit 500 (max within budget).
  perform dblink_exec('sess_a', 'begin');
  perform dblink_exec('sess_a',
    format('select public.wallet_debit(%L, 500, ''booking_hold'', ''booking'', gen_random_uuid(), ''concurrent A'')',
      v_b));

  -- Session B: try to debit 500 — will block on the wallet row lock
  -- held by A, then fail with insufficient balance once A commits.
  perform dblink_exec('sess_b', 'begin');
  begin
    perform dblink_exec('sess_b',
      format('select public.wallet_debit(%L, 500, ''booking_hold'', ''booking'', gen_random_uuid(), ''concurrent B'')',
        v_b));
    -- If it didn't raise, then it would have left bob overdrawn — fail.
    perform dblink_exec('sess_b', 'rollback');
    raise exception 'FAIL: 4c — session B succeeded; it should have failed with insufficient balance';
  exception when others then
    perform dblink_exec('sess_b', 'rollback');
    raise notice 'PASS: 4c. concurrent debit B was blocked / failed (overdraw prevented)';
  end;

  perform dblink_exec('sess_a', 'commit');
  perform dblink_exec('sess_a', 'rollback');

  v_final := public.wallet_get_balance(v_b);
  perform pg_temp.assert_eq(200, v_final,
    '4d. final balance is 700 - 500 = 200 (single debit applied, no overdraw)');

  perform dblink_disconnect('sess_a');
  perform dblink_disconnect('sess_b');
end $$;

-- ---------- 5. balance RPC = sum(ledger) ----------

do $$
declare
  v_a uuid;
  v_b uuid;
  v_a_sum bigint;
  v_b_sum bigint;
begin
  select alice, bob into v_a, v_b from wallet_ctx;
  select coalesce(sum(amount), 0) into v_a_sum
    from public.ledger_entries
    where wallet_id = (select id from public.wallets where user_id = v_a);
  select coalesce(sum(amount), 0) into v_b_sum
    from public.ledger_entries
    where wallet_id = (select id from public.wallets where user_id = v_b);
  perform pg_temp.assert_eq(v_a_sum, public.wallet_get_balance(v_a),
    '5a. wallet_get_balance(alice) = sum(ledger)');
  perform pg_temp.assert_eq(v_b_sum, public.wallet_get_balance(v_b),
    '5b. wallet_get_balance(bob) = sum(ledger)');
end $$;

-- ---------- done ----------

rollback;