-- StripClub — schema: enums, tables, functions, triggers, indexes.
-- Conventions:
--   * Money is a LEDGER (append-only rows). Wallets have no balance column;
--     balance = sum(ledger_entries). UPDATE/DELETE on ledger are rejected.
--   * audit_log is append-only.
--   * Soft delete only: soft_deleted_at columns, no hard deletes from the app.

-- ============================================================ enums

create type public.user_role as enum ('buyer', 'seller', 'support', 'finance', 'owner');

create type public.ledger_entry_type as enum (
  'topup', 'booking_hold', 'booking_release', 'booking_refund',
  'payout', 'support_adjustment', 'bonus'
);

create type public.payment_status as enum ('pending', 'confirmed', 'failed', 'expired');
create type public.topup_status as enum ('pending', 'completed', 'failed', 'expired');

create type public.booking_status as enum (
  'paid', 'scheduled', 'live', 'completed', 'released',
  'cancelled', 'seller_no_show', 'disputed'
);

create type public.slot_status as enum ('open', 'booked', 'blocked');

create type public.seller_application_status as enum ('pending', 'approved', 'rejected');
create type public.dispute_status as enum ('open', 'resolved', 'dismissed');
create type public.payout_status as enum ('pending', 'approved', 'paid', 'rejected', 'cancelled');

create type public.notification_type as enum ('booking', 'chat', 'dispute', 'payout', 'system');

-- ============================================================ tables

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text,
  bio text check (char_length(bio) <= 500),
  is_banned boolean not null default false,
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Append-only token ledger. amount is signed: credits > 0, debits < 0.
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  entry_type public.ledger_entry_type not null,
  amount integer not null check (amount <> 0),
  ref_type text,          -- 'payment' | 'booking' | 'payout' | 'support' | null
  ref_id uuid,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index ledger_wallet_idx on public.ledger_entries(wallet_id, created_at desc);

create table public.token_packs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  price_pkr integer not null unique check (price_pkr > 0),
  tokens integer not null unique check (tokens > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 1 PKR = 2 tokens (enforced at seed time and by app logic).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  external_id text not null unique,          -- NOWPayments payment_id (idempotency key)
  token_pack_id uuid references public.token_packs(id),
  status public.payment_status not null default 'pending',
  price_pkr integer not null check (price_pkr > 0),
  tokens integer not null check (tokens > 0),
  pay_currency text,
  pay_amount numeric(18, 8),
  invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_user_idx on public.payments(user_id, created_at desc);

create table public.topup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  transaction_id text not null unique,       -- external payment/tx id (idempotency key)
  tokens integer not null check (tokens > 0),
  status public.topup_status not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index topups_user_idx on public.topup_requests(user_id, created_at desc);

create table public.seller_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  motivation text not null check (char_length(motivation) <= 2000),
  social_links text,
  status public.seller_application_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) <= 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  tagline text check (char_length(tagline) <= 120),
  bio text,
  avatar_url text,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  category_id uuid references public.categories(id),
  title text not null check (char_length(title) between 3 and 120),
  description text,
  price_tokens integer not null check (price_tokens > 0),
  duration_minutes integer not null check (duration_minutes between 5 and 240),
  is_active boolean not null default true,
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_seller_idx on public.listings(seller_id);
create index listings_category_idx on public.listings(category_id);

create table public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_tokens integer not null check (price_tokens > 0),
  status public.slot_status not null default 'open',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index slots_listing_start_idx on public.availability_slots(listing_id, starts_at);
create unique index slots_open_unique on public.availability_slots(listing_id, starts_at)
  where status = 'open';

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id),
  listing_id uuid not null references public.listings(id),
  slot_id uuid not null unique references public.availability_slots(id),
  price_tokens integer not null check (price_tokens > 0),
  status public.booking_status not null default 'paid',
  livekit_room text,
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_buyer_idx on public.bookings(buyer_id, created_at desc);
create index bookings_seller_idx on public.bookings(seller_id, created_at desc);

-- One chat per booking (unique). No free DMs anywhere else.
create table public.booking_chats (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.booking_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.booking_chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_chat_idx on public.booking_messages(chat_id, created_at);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  opened_by uuid not null references public.profiles(id),
  reason text not null,
  status public.dispute_status not null default 'open',
  resolution_note text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index disputes_booking_idx on public.disputes(booking_id);

create table public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  tokens integer not null check (tokens > 0),
  status public.payout_status not null default 'pending',
  note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index payouts_seller_idx on public.payout_requests(seller_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null default 'system',
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Append-only. Every admin action writes here.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_actor_idx on public.audit_log(actor_id, created_at desc);
create index audit_target_idx on public.audit_log(target_type, target_id);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- ============================================================ functions

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is forbidden: table is append-only', TG_OP, TG_TABLE_NAME
    using errcode = 'raise_exception';
end $$;

-- Auto-create profile, buyer role, and wallet on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    )
  );
  insert into public.user_roles (user_id, role) values (new.id, 'buyer');
  insert into public.wallets (user_id) values (new.id);
  return new;
end $$;

-- Balance = sum of the ledger. Never a stored, mutable balance.
create or replace function public.get_own_wallet_balance()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(le.amount), 0)::integer
  from public.ledger_entries le
  join public.wallets w on w.id = le.wallet_id
  where w.user_id = auth.uid()
$$;
revoke all on function public.get_own_wallet_balance() from public, anon;
grant execute on function public.get_own_wallet_balance() to authenticated;

-- Server-side role check helper for future admin actions.
create or replace function public.user_has_role(_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = _role
  )
$$;
grant execute on function public.user_has_role(public.user_role) to authenticated;

-- ============================================================ triggers

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function public.forbid_mutation();

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

create trigger seller_profiles_set_updated_at
  before update on public.seller_profiles
  for each row execute function public.set_updated_at();

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();
