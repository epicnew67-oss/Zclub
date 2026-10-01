-- StripClub — Row Level Security.
-- Users only read their own wallet, ledger, bookings, and chats.
-- audit_log has RLS enabled with no policies: service role only.
-- All money/state writes (ledger, payments, topups, bookings, payouts,
-- disputes, audit) stay server-side — no client insert/update policies.

alter table public.profiles             enable row level security;
alter table public.user_roles           enable row level security;
alter table public.wallets              enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.token_packs          enable row level security;
alter table public.payments             enable row level security;
alter table public.topup_requests       enable row level security;
alter table public.seller_applications  enable row level security;
alter table public.seller_profiles      enable row level security;
alter table public.categories           enable row level security;
alter table public.listings             enable row level security;
alter table public.availability_slots   enable row level security;
alter table public.bookings             enable row level security;
alter table public.booking_chats       enable row level security;
alter table public.booking_messages    enable row level security;
alter table public.disputes             enable row level security;
alter table public.payout_requests     enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_log            enable row level security;
alter table public.settings            enable row level security;

-- profiles: public read, self update (soft-delete/ban flags stay server-side).
create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- user_roles: read your own. Grants happen server-side only.
create policy "user_roles_select_own" on public.user_roles
  for select using (auth.uid() = user_id);

-- wallets: read your own only.
create policy "wallets_select_own" on public.wallets
  for select using (auth.uid() = user_id);

-- ledger: read your own wallet's entries only. No client writes.
create policy "ledger_entries_select_own" on public.ledger_entries
  for select using (
    exists (
      select 1 from public.wallets w
      where w.id = ledger_entries.wallet_id and w.user_id = auth.uid()
    )
  );

-- token packs: public read (anon included, for pricing pages).
create policy "token_packs_select" on public.token_packs
  for select using (true);

-- payments / topups: read your own only.
create policy "payments_select_own" on public.payments
  for select using (auth.uid() = user_id);
create policy "topup_requests_select_own" on public.topup_requests
  for select using (auth.uid() = user_id);

-- seller applications: read your own.
create policy "seller_applications_select_own" on public.seller_applications
  for select using (auth.uid() = user_id);

-- seller profiles: public read, self update.
create policy "seller_profiles_select" on public.seller_profiles
  for select using (true);
create policy "seller_profiles_update_own" on public.seller_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- categories: public read.
create policy "categories_select" on public.categories
  for select using (true);

-- listings: public read; sellers write their own.
create policy "listings_select" on public.listings
  for select using (true);
create policy "listings_insert_own" on public.listings
  for insert with check (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = listings.seller_id and sp.user_id = auth.uid()
    )
  );
create policy "listings_update_own" on public.listings
  for update using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = listings.seller_id and sp.user_id = auth.uid()
    )
  );

-- availability slots: public read; listing owner writes.
create policy "slots_select" on public.availability_slots
  for select using (true);
create policy "slots_insert_own" on public.availability_slots
  for insert with check (
    exists (
      select 1
      from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = availability_slots.listing_id and sp.user_id = auth.uid()
    )
  );
create policy "slots_update_own" on public.availability_slots
  for update using (
    exists (
      select 1
      from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = availability_slots.listing_id and sp.user_id = auth.uid()
    )
  );

-- bookings: participants only (buyer or seller).
create policy "bookings_select_own" on public.bookings
  for select using (
    auth.uid() = bookings.buyer_id or auth.uid() = bookings.seller_id
  );

-- booking chats: participants only. One chat per booking (unique constraint).
create policy "booking_chats_select_own" on public.booking_chats
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_chats.booking_id
        and (auth.uid() = b.buyer_id or auth.uid() = b.seller_id)
    )
  );

-- messages: participants read; participants send as themselves.
create policy "booking_messages_select_own" on public.booking_messages
  for select using (
    exists (
      select 1
      from public.booking_chats c
      join public.bookings b on b.id = c.booking_id
      where c.id = booking_messages.chat_id
        and (auth.uid() = b.buyer_id or auth.uid() = b.seller_id)
    )
  );
create policy "booking_messages_insert_own" on public.booking_messages
  for insert with check (
    auth.uid() = booking_messages.sender_id
    and exists (
      select 1
      from public.booking_chats c
      join public.bookings b on b.id = c.booking_id
      where c.id = booking_messages.chat_id
        and (auth.uid() = b.buyer_id or auth.uid() = b.seller_id)
    )
  );

-- disputes: participants read. Creation/resolution is server-side.
create policy "disputes_select_own" on public.disputes
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = disputes.booking_id
        and (auth.uid() = b.buyer_id or auth.uid() = b.seller_id)
    )
  );

-- payouts: sellers read their own.
create policy "payout_requests_select_own" on public.payout_requests
  for select using (auth.uid() = seller_id);

-- notifications: read + mark-read for your own.
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- settings: public read (rates, config). Writes are server-side.
create policy "settings_select" on public.settings
  for select using (true);
