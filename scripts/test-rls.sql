-- scripts/test-rls.sql — StripClub RLS smoke test.
--
-- Run as postgres (bypasses RLS for fixtures, then switches roles):
--   local:   npx supabase db sql --file scripts/test-rls.sql
--   hosted: paste into the Supabase SQL editor and run.
--
-- Creates throwaway users/fixtures, asserts the policies, and rolls back.
-- Every check prints PASS (notice) or FAIL (exception).

begin;

create function pg_temp.assert_eq(expected bigint, got bigint, msg text)
returns void language plpgsql as $$
begin
  if got = expected then
    raise notice 'PASS: % (%)', msg, got;
  else
    raise exception 'FAIL: % (expected %, got %)', msg, expected, got;
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

-- RLS default-deny UPDATE/DELETE/SELECT silently affect 0 rows (no error),
-- so those are asserted via row counts, not errors.
create function pg_temp.assert_affected(expected bigint, stmt text, msg text)
returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n = expected then
    raise notice 'PASS: % (%)', msg, n;
  else
    raise exception 'FAIL: % (expected % affected, got %)', msg, expected, n;
  end if;
end $$;

-- ---------- fixtures (as postgres) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at)
values
  (gen_random_uuid(), 'rls-buyer@test.local', 'test-password', now()),
  (gen_random_uuid(), 'rls-seller@test.local', 'test-password', now());

create temp table rls_ctx on commit drop as
select
  (select id from auth.users where email = 'rls-buyer@test.local') as buyer,
  (select id from auth.users where email = 'rls-seller@test.local') as seller;

-- fixtures run as postgres; the role-switched assertions below read this too
grant select on rls_ctx to authenticated, anon;

select pg_temp.assert_eq(2, (select count(*) from public.profiles
  where id in (select buyer from rls_ctx) or id in (select seller from rls_ctx)),
  'signup trigger created both profiles');
select pg_temp.assert_eq(2, (select count(*) from public.user_roles
  where role = 'buyer' and (user_id in (select buyer from rls_ctx) or user_id in (select seller from rls_ctx))),
  'signup trigger granted both users the buyer role');
select pg_temp.assert_eq(2, (select count(*) from public.wallets
  where user_id in (select buyer from rls_ctx) or user_id in (select seller from rls_ctx)),
  'signup trigger created both wallets');

-- ledger + booking + chat fixtures (as postgres)
insert into public.ledger_entries (wallet_id, entry_type, amount, description)
select w.id, 'topup', 1000, 'rls test topup' from public.wallets w
  join rls_ctx c on c.buyer = w.user_id;
insert into public.ledger_entries (wallet_id, entry_type, amount, description)
select w.id, 'topup', 500, 'rls test topup' from public.wallets w
  join rls_ctx c on c.seller = w.user_id;

insert into public.seller_profiles (user_id, display_name, slug)
select seller, 'RLS Seller', 'rls-seller' from rls_ctx;
insert into public.categories (name, slug) values ('RLS test', 'rls-test');
insert into public.listings (seller_id, category_id, title, price_tokens, duration_minutes)
select sp.id, cat.id, 'RLS test listing', 100, 30
from public.seller_profiles sp, public.categories cat, rls_ctx c
where sp.user_id = c.seller and cat.slug = 'rls-test';
insert into public.availability_slots (listing_id, starts_at, ends_at, price_tokens, status)
select l.id, now() + interval '1 day', now() + interval '1 day 30 minutes', 100, 'booked'
from public.listings l where l.title = 'RLS test listing';
insert into public.bookings (buyer_id, seller_id, listing_id, slot_id, price_tokens)
select c.buyer, c.seller, l.id, s.id, 100
from rls_ctx c, public.listings l, public.availability_slots s
where l.id = s.listing_id and l.title = 'RLS test listing';
insert into public.booking_chats (booking_id)
select b.id from public.bookings b, rls_ctx c where b.buyer_id = c.buyer;

select pg_temp.assert_eq(5, (select count(*) from public.token_packs), 'token packs seeded');
select pg_temp.assert_eq(6, (select count(*) from public.categories where slug <> 'rls-test'), 'default categories seeded');

-- ---------- append-only guards (as postgres, hits the triggers) ----------

select pg_temp.assert_blocked('update public.ledger_entries set amount = 999',
  'ledger UPDATE is blocked (append-only)');
select pg_temp.assert_blocked('delete from public.ledger_entries',
  'ledger DELETE is blocked (append-only)');
insert into public.audit_log (actor_id, action, target_type)
select buyer, 'rls test action', 'test' from rls_ctx;
select pg_temp.assert_blocked('update public.audit_log set action = ''tampered''',
  'audit_log UPDATE is blocked (append-only)');
select pg_temp.assert_blocked('delete from public.audit_log',
  'audit_log DELETE is blocked (append-only)');

-- ---------- as the buyer ----------

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select buyer from rls_ctx), 'role', 'authenticated')::text, true);

select pg_temp.assert_eq(1, (select count(*) from public.wallets), 'buyer sees only own wallet');
select pg_temp.assert_eq(1, (select count(*) from public.ledger_entries), 'buyer sees only own ledger entries');
select pg_temp.assert_eq(1000, (select public.get_own_wallet_balance()), 'buyer balance = sum of ledger');
select pg_temp.assert_eq(1, (select count(*) from public.bookings), 'buyer sees own booking');
select pg_temp.assert_eq(1, (select count(*) from public.booking_chats), 'buyer sees own booking chat');
select pg_temp.assert_eq(1, (select count(*) from public.user_roles), 'buyer sees own roles');

select pg_temp.assert_blocked(
  'insert into public.ledger_entries (wallet_id, entry_type, amount) ' ||
  'select w.id, ''topup'', 1 from public.wallets w, rls_ctx c where c.buyer = w.user_id',
  'buyer cannot INSERT into ledger');
select pg_temp.assert_affected(0,
  'update public.bookings set status = ''released''',
  'buyer cannot UPDATE bookings (0 rows — state changes are server-side)');
select pg_temp.assert_eq(1, (select count(*) from public.bookings where status = 'paid'),
  'booking status is still paid after the blocked update');
select pg_temp.assert_blocked(
  'insert into public.wallets (user_id) values ((select buyer from rls_ctx))',
  'buyer cannot create wallets');
select pg_temp.assert_blocked(
  'insert into public.audit_log (action) values (''forged'')',
  'buyer cannot write audit_log');
select pg_temp.assert_eq(0, (select count(*) from public.audit_log),
  'buyer sees no audit_log rows');

-- ---------- as the seller ----------

set local role postgres;
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select seller from rls_ctx), 'role', 'authenticated')::text, true);

select pg_temp.assert_eq(1, (select count(*) from public.wallets), 'seller sees only own wallet');
select pg_temp.assert_eq(1, (select count(*) from public.ledger_entries), 'seller sees only own ledger entries');
select pg_temp.assert_eq(500, (select public.get_own_wallet_balance()), 'seller balance = sum of ledger');
select pg_temp.assert_eq(1, (select count(*) from public.bookings), 'seller (participant) sees the booking');
select pg_temp.assert_eq(1, (select count(*) from public.booking_chats), 'seller (participant) sees the booking chat');

-- seller can send a message into the chat as themselves, not as the buyer
insert into public.booking_messages (chat_id, sender_id, body)
select c.id, ctx.seller, 'rls test message'
from public.booking_chats c, rls_ctx ctx;
select pg_temp.assert_eq(1, (select count(*) from public.booking_messages), 'participant message inserted');
select pg_temp.assert_blocked(
  'insert into public.booking_messages (chat_id, sender_id, body) ' ||
  'select c.id, ctx.buyer, ''spoofed sender'' from public.booking_chats c, rls_ctx ctx',
  'seller cannot send messages as the buyer (sender must be auth.uid())');
select pg_temp.assert_blocked(
  'insert into public.booking_chats (booking_id) ' ||
  'select b.id from public.bookings b, rls_ctx ctx where b.buyer_id = ctx.buyer',
  'participants cannot create booking chats (one chat per booking, server-side only)');

-- ---------- as anon ----------

set local role postgres;
select set_config('request.jwt.claims', '{}', true);
set local role anon;

select pg_temp.assert_eq(5, (select count(*) from public.token_packs), 'anon can browse token packs');
select pg_temp.assert_eq(6, (select count(*) from public.categories where slug <> 'rls-test'), 'anon can browse default categories');
select pg_temp.assert_eq(0, (select count(*) from public.wallets), 'anon sees no wallets');
select pg_temp.assert_eq(0, (select count(*) from public.bookings), 'anon sees no bookings');
select pg_temp.assert_eq(0, (select count(*) from public.ledger_entries), 'anon sees no ledger');
select pg_temp.assert_eq(0, (select count(*) from public.audit_log),
  'anon sees no audit_log rows');

-- ---------- done ----------

rollback;

