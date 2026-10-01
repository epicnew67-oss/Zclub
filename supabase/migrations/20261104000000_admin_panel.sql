-- ============================================
-- Remaining admin panel — schema, settings, RPCs
-- ============================================
-- This migration is the SQL foundation for the role-based admin
-- sidebar, dashboard, customers, sellers (extended), chat logs,
-- website settings, audit viewer, reports, and top-ups view that
-- the new /admin layout wraps.
--
-- Money settings (commission / payout_min_tokens / token_rate /
-- payment_rates) remain owner-only via the admin_settings_update
-- RPC; everything else is support + owner.
--
-- All money / state writes go through SECURITY DEFINER RPCs. Pages
-- never write to tables directly. Every mutation writes a row to
-- the append-only audit_log.
--
-- On a fresh checkout this is the last admin-panel migration to
-- apply. Verified with `supabase db reset && npm test`.

-- ============================================
-- Settings seed — chat retention (idempotent)
-- ============================================
insert into public.settings (key, value)
values ('chat_retention_days', jsonb_build_object('days', 90))
on conflict (key) do nothing;

-- ============================================
-- Tables — banners + announcements (website settings console)
-- ============================================
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  body text not null,
  link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (length(label) between 1 and 80),
  check (length(body) between 1 and 500)
);
create index if not exists banners_active_window_idx
  on public.banners(is_active, starts_at, ends_at);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_active boolean not null default true,
  posted_by uuid references public.profiles(id),
  posted_at timestamptz not null default now(),
  check (length(title) between 1 and 120),
  check (length(body) between 1 and 2000)
);
create index if not exists announcements_active_idx
  on public.announcements(is_active, posted_at desc);

-- Add banners + announcements to the realtime publication. Wrap the
-- ALTER in a DO block so a re-run on a stack that already has them
-- is a no-op (matching the pattern used in
-- 20261103000000_post_call_money.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'banners'
  ) then
    alter publication supabase_realtime add table public.banners;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;

-- ============================================
-- Dashboard stats — role: support / finance / owner
-- ============================================
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_sales_30d int := 0;
  v_new_users_7d int := 0;
  v_active_sellers int := 0;
  v_bookings_by_state jsonb := '{}'::jsonb;
  v_pending_listings int := 0;
  v_pending_apps int := 0;
  v_pending_payouts int := 0;
  v_open_disputes int := 0;
begin
  if v_actor is null then
    raise exception 'admin_dashboard_stats: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_dashboard_stats: admin role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- sales_30d = sum(price_tokens) for bookings released in last 30d
  select coalesce(sum(price_tokens), 0)::int into v_sales_30d
    from public.bookings
    where status = 'released'
      and released_at >= now() - interval '30 days';

  -- new_users_7d
  select count(*)::int into v_new_users_7d
    from public.profiles
    where created_at >= now() - interval '7 days'
      and soft_deleted_at is null;

  -- active_sellers
  select count(distinct user_id)::int into v_active_sellers
    from public.seller_profiles
    where is_active = true and soft_deleted_at is null;

  -- bookings_by_state
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_bookings_by_state
    from (
      select status, count(*)::int as cnt
      from public.bookings
      where created_at >= now() - interval '30 days'
      group by status
    ) s;

  -- pending queues
  select count(*)::int into v_pending_listings
    from public.listings where status = 'pending_review';
  select count(*)::int into v_pending_apps
    from public.seller_applications where status = 'pending';
  select count(*)::int into v_pending_payouts
    from public.payout_requests where status = 'pending';
  select count(*)::int into v_open_disputes
    from public.disputes where status = 'open';

  return jsonb_build_object(
    'sales_30d_tokens', v_sales_30d,
    'new_users_7d', v_new_users_7d,
    'active_sellers', v_active_sellers,
    'bookings_by_state', v_bookings_by_state,
    'pending_queues', jsonb_build_object(
      'listings', v_pending_listings,
      'applications', v_pending_apps,
      'payouts', v_pending_payouts,
      'disputes', v_open_disputes
    )
  );
end;
$$;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ============================================
-- Customer search — support / owner
-- ============================================
create or replace function public.admin_user_search(
  _query text,
  _limit int default 25,
  _offset int default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_q text;
  v_rows jsonb;
begin
  if v_actor is null then
    raise exception 'admin_user_search: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_user_search: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_q := '%' || lower(coalesce(_query, '')) || '%';

  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into v_rows
  from (
    select
      p.id,
      p.display_name,
      p.avatar_url,
      p.is_banned,
      p.soft_deleted_at,
      p.created_at,
      coalesce(bal.balance, 0)::int as balance,
      (
        select array_agg(role order by role)
        from public.user_roles ur
        where ur.user_id = p.id
      ) as roles,
      (
        select count(*)::int
        from public.bookings bk
        where bk.buyer_id = p.id or bk.seller_id = p.id
      ) as bookings_count
    from public.profiles p
    left join lateral (
      select coalesce(sum(le.amount), 0)::int as balance
      from public.ledger_entries le
      join public.wallets w on w.id = le.wallet_id
      where w.user_id = p.id
    ) bal on true
    where lower(p.display_name) like v_q
       or lower(p.id::text) like v_q
    order by p.created_at desc
    limit greatest(_limit, 1)
    offset greatest(_offset, 0)
  ) s;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_user_search(text, int, int) to authenticated;

-- ============================================
-- Customer detail — support / finance / owner
-- ============================================
create or replace function public.admin_user_detail(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles;
  v_roles jsonb;
  v_balance int := 0;
  v_in_escrow int := 0;
  v_ledger jsonb := '[]'::jsonb;
  v_bookings jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_user_detail: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_user_detail: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_profile from public.profiles where id = _user_id;
  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select coalesce(jsonb_agg(role order by role), '[]'::jsonb) into v_roles
    from public.user_roles where user_id = _user_id;

  select coalesce(sum(le.amount), 0)::int into v_balance
    from public.ledger_entries le
    join public.wallets w on w.id = le.wallet_id
    where w.user_id = _user_id;

  select coalesce(sum(price_tokens), 0)::int into v_in_escrow
    from public.bookings
    where seller_id = _user_id
      and status in ('paid','scheduled','live','completed','disputed');

  select coalesce(jsonb_agg(row_to_json(l) order by l.created_at desc), '[]'::jsonb)
    into v_ledger
  from (
    select
      le.id,
      le.amount,
      le.entry_type,
      le.ref_type,
      le.ref_id,
      le.description,
      le.created_at
    from public.ledger_entries le
    join public.wallets w on w.id = le.wallet_id
    where w.user_id = _user_id
    order by le.created_at desc
    limit 50
  ) l;

  select coalesce(jsonb_agg(row_to_json(bk) order by bk.created_at desc), '[]'::jsonb)
    into v_bookings
  from (
    select
      id, buyer_id, seller_id, price_tokens, status, created_at, released_at
    from public.bookings
    where buyer_id = _user_id or seller_id = _user_id
    order by created_at desc
    limit 10
  ) bk;

  return jsonb_build_object(
    'ok', true,
    'profile', row_to_json(v_profile),
    'roles', v_roles,
    'balance', v_balance,
    'in_escrow', v_in_escrow,
    'ledger', v_ledger,
    'bookings', v_bookings
  );
end;
$$;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- ============================================
-- Set user ban — support / owner
-- ============================================
create or replace function public.admin_set_user_ban(
  _user_id uuid,
  _banned boolean,
  _note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'admin_set_user_ban: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_set_user_ban: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if _user_id = v_actor then
    return jsonb_build_object('ok', false, 'code', 'cannot_ban_self');
  end if;

  update public.profiles
    set is_banned = coalesce(_banned, true)
    where id = _user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'user.ban', 'profile', _user_id,
    jsonb_build_object('banned', coalesce(_banned, true), 'note', nullif(btrim(coalesce(_note, '')), ''))
  );

  return jsonb_build_object('ok', true, 'user_id', _user_id, 'banned', coalesce(_banned, true));
end;
$$;
grant execute on function public.admin_set_user_ban(uuid, boolean, text) to authenticated;

-- ============================================
-- Soft delete user — support / owner
-- ============================================
create or replace function public.admin_soft_delete_user(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_active_bookings int := 0;
  v_pending_payouts int := 0;
  v_pending_topups int := 0;
begin
  if v_actor is null then
    raise exception 'admin_soft_delete_user: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_soft_delete_user: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if _user_id = v_actor then
    return jsonb_build_object('ok', false, 'code', 'cannot_delete_self');
  end if;

  if not exists (select 1 from public.profiles where id = _user_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select count(*)::int into v_active_bookings
    from public.bookings
    where (buyer_id = _user_id or seller_id = _user_id)
      and status in ('paid','scheduled','live','completed','disputed');
  if v_active_bookings > 0 then
    return jsonb_build_object('ok', false, 'code', 'escrow_pending', 'active_bookings', v_active_bookings);
  end if;

  select count(*)::int into v_pending_payouts
    from public.payout_requests
    where seller_id = _user_id and status in ('pending','approved');
  if v_pending_payouts > 0 then
    return jsonb_build_object('ok', false, 'code', 'escrow_pending', 'pending_payouts', v_pending_payouts);
  end if;

  select count(*)::int into v_pending_topups
    from public.topup_requests
    where user_id = _user_id and status = 'pending';
  if v_pending_topups > 0 then
    return jsonb_build_object('ok', false, 'code', 'pending_topups');
  end if;

  update public.profiles
    set soft_deleted_at = now()
    where id = _user_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'user.soft_delete', 'profile', _user_id,
    jsonb_build_object('source', 'admin_user_panel')
  );

  return jsonb_build_object('ok', true, 'user_id', _user_id);
end;
$$;
grant execute on function public.admin_soft_delete_user(uuid) to authenticated;

-- ============================================
-- Wallet adjustment — OWNER only
-- ============================================
create or replace function public.admin_wallet_adjust(
  _user_id uuid,
  _amount int,
  _reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text;
  v_ledger_id uuid;
  v_balance int;
begin
  if v_actor is null then
    raise exception 'admin_wallet_adjust: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('owner') then
    raise exception 'admin_wallet_adjust: owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_reason := btrim(coalesce(_reason, ''));
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'note_too_short');
  end if;

  if _amount is null or _amount = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_amount');
  end if;

  if not exists (select 1 from public.wallets where user_id = _user_id) then
    return jsonb_build_object('ok', false, 'code', 'no_wallet');
  end if;

  if _amount > 0 then
    perform public.wallet_credit(
      _user_id, _amount,
      'support_adjustment'::public.ledger_entry_type,
      'admin_adjustment', gen_random_uuid(),
      format('Adjustment by %s: %s', coalesce((select email from auth.users where id = v_actor), 'owner'), v_reason),
      v_actor
    );
  else
    -- Debit. check_violation (insufficient balance) surfaces as
    -- INSUFFICIENT_BALANCE via the wallet_debit internal check.
    begin
      perform public.wallet_debit(
        _user_id, -_amount,
        'support_adjustment'::public.ledger_entry_type,
        'admin_adjustment', gen_random_uuid(),
        format('Adjustment by %s: %s', coalesce((select email from auth.users where id = v_actor), 'owner'), v_reason),
        v_actor
      );
    exception when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE');
    end;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'wallet.adjust', 'profile', _user_id,
    jsonb_build_object('amount', _amount, 'reason', v_reason)
  );

  v_balance := public.wallet_get_balance(_user_id);

  return jsonb_build_object(
    'ok', true,
    'user_id', _user_id,
    'amount', _amount,
    'reason', v_reason,
    'balance', v_balance
  );
end;
$$;
grant execute on function public.admin_wallet_adjust(uuid, int, text) to authenticated;

-- ============================================
-- Seller: verify / active / soft-delete — support / owner
-- ============================================
create or replace function public.admin_seller_set_verified(
  _seller_user_id uuid,
  _verified boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'admin_seller_set_verified: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_seller_set_verified: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  update public.seller_profiles
    set is_verified = coalesce(_verified, true)
    where user_id = _seller_user_id
    returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_seller');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'seller.verify', 'seller_profile', v_id,
    jsonb_build_object('verified', coalesce(_verified, true))
  );

  return jsonb_build_object('ok', true, 'verified', coalesce(_verified, true));
end;
$$;
grant execute on function public.admin_seller_set_verified(uuid, boolean) to authenticated;

create or replace function public.admin_seller_set_active(
  _seller_user_id uuid,
  _active boolean,
  _refund_strategy text default 'finish'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_in_flight int := 0;
begin
  if v_actor is null then
    raise exception 'admin_seller_set_active: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_seller_set_active: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if _refund_strategy not in ('finish', 'refund_in_progress') then
    return jsonb_build_object('ok', false, 'code', 'bad_refund_strategy');
  end if;

  update public.seller_profiles
    set is_active = coalesce(_active, true)
    where user_id = _seller_user_id
    returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_seller');
  end if;

  if coalesce(_active, true) = false then
    select count(*)::int into v_in_flight
      from public.bookings
      where seller_id = _seller_user_id
        and status in ('paid','scheduled','live');
    if v_in_flight > 0 and _refund_strategy = 'finish' then
      -- revert: don't suspend if there are in-flight bookings
      update public.seller_profiles set is_active = true where id = v_id;
      return jsonb_build_object(
        'ok', false,
        'code', 'has_in_flight_bookings',
        'in_flight', v_in_flight
      );
    end if;
    if v_in_flight > 0 and _refund_strategy = 'refund_in_progress' then
      -- Mark the seller inactive; the in-flight bookings stay open
      -- so they can complete the calls the buyer already paid for.
      -- The refund path is exposed to support via the disputes page.
      insert into public.audit_log (actor_id, action, target_type, target_id, details)
      values (
        v_actor, 'seller.suspend_in_flight', 'seller_profile', v_id,
        jsonb_build_object('in_flight', v_in_flight)
      );
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'seller.active', 'seller_profile', v_id,
    jsonb_build_object('active', coalesce(_active, true), 'refund_strategy', _refund_strategy)
  );

  return jsonb_build_object(
    'ok', true,
    'active', coalesce(_active, true),
    'in_flight_kept', v_in_flight
  );
end;
$$;
grant execute on function public.admin_seller_set_active(uuid, boolean, text) to authenticated;

create or replace function public.admin_soft_delete_seller(_seller_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_non_terminal int := 0;
  v_pending_payouts int := 0;
begin
  if v_actor is null then
    raise exception 'admin_soft_delete_seller: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_soft_delete_seller: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from public.seller_profiles
    where user_id = _seller_user_id and soft_deleted_at is null;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select count(*)::int into v_non_terminal
    from public.bookings
    where seller_id = _seller_user_id
      and status in ('paid','scheduled','live','completed','disputed');
  if v_non_terminal > 0 then
    return jsonb_build_object('ok', false, 'code', 'escrow_pending', 'non_terminal', v_non_terminal);
  end if;

  select count(*)::int into v_pending_payouts
    from public.payout_requests
    where seller_id = _seller_user_id and status in ('pending','approved');
  if v_pending_payouts > 0 then
    return jsonb_build_object('ok', false, 'code', 'escrow_pending', 'pending_payouts', v_pending_payouts);
  end if;

  update public.seller_profiles
    set soft_deleted_at = now()
    where id = v_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'seller.soft_delete', 'seller_profile', v_id,
    jsonb_build_object('user_id', _seller_user_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_soft_delete_seller(uuid) to authenticated;

-- ============================================
-- Chat logs — list eligible bookings + view messages
-- ============================================
create or replace function public.admin_list_chat_log_bookings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_retention_days int := 90;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_list_chat_log_bookings: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_list_chat_log_bookings: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce((value #>> '{days}')::int, 90) into v_retention_days
    from public.settings where key = 'chat_retention_days';
  if v_retention_days is null then v_retention_days := 90; end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
  from (
    select
      bk.id as booking_id,
      li.title as listing_title,
      bp.display_name as buyer_name,
      sp.display_name as seller_name,
      bk.status as booking_status,
      bk.live_ended_at,
      coalesce(
        (select max(created_at) from public.booking_messages bm
         join public.booking_chats bc on bc.id = bm.chat_id
         where bc.booking_id = bk.id),
        bk.live_ended_at
      ) as last_message_at
    from public.bookings bk
    join public.listings li on li.id = bk.listing_id
    join public.profiles bp on bp.id = bk.buyer_id
    join public.profiles sp on sp.id = bk.seller_id
    where bk.status in ('completed','disputed','cancelled','seller_no_show')
      and bk.live_ended_at is not null
      and bk.live_ended_at > now() - make_interval(days => v_retention_days)
    order by bk.live_ended_at desc
    limit 200
  ) t;

  return jsonb_build_object('rows', v_rows, 'retention_days', v_retention_days);
end;
$$;
grant execute on function public.admin_list_chat_log_bookings() to authenticated;

create or replace function public.admin_get_chat_log(
  _booking_id uuid,
  _reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text;
  v_booking public.bookings;
  v_retention_days int := 90;
  v_chat_id uuid;
  v_messages jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_get_chat_log: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_get_chat_log: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_reason := btrim(coalesce(_reason, ''));
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_short');
  end if;

  select * into v_booking from public.bookings where id = _booking_id;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_booking.status not in ('completed','disputed','cancelled','seller_no_show') then
    return jsonb_build_object('ok', false, 'code', 'wrong_state', 'status', v_booking.status);
  end if;
  if v_booking.live_ended_at is null then
    return jsonb_build_object('ok', false, 'code', 'no_live_ended_at');
  end if;

  select coalesce((value #>> '{days}')::int, 90) into v_retention_days
    from public.settings where key = 'chat_retention_days';
  if v_retention_days is null then v_retention_days := 90; end if;
  if v_booking.live_ended_at < now() - make_interval(days => v_retention_days) then
    return jsonb_build_object('ok', false, 'code', 'retention_expired', 'retention_days', v_retention_days);
  end if;

  select id into v_chat_id from public.booking_chats where booking_id = _booking_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'chat_log.view', 'booking', _booking_id,
    jsonb_build_object('reason', v_reason)
  );

  if v_chat_id is not null then
    select coalesce(jsonb_agg(row_to_json(m) order by m.created_at), '[]'::jsonb)
      into v_messages
    from (
      select id, sender_id, body, created_at
      from public.booking_messages
      where chat_id = v_chat_id
      order by created_at asc
      limit 500
    ) m;
  end if;

  return jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'status', v_booking.status,
    'messages', v_messages
  );
end;
$$;
grant execute on function public.admin_get_chat_log(uuid, text) to authenticated;

-- ============================================
-- Audit log viewer — support / finance / owner
-- ============================================
create or replace function public.admin_list_audit_log(
  _action_filter text default null,
  _target_type text default null,
  _limit int default 100,
  _offset int default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
  v_action text;
  v_target text;
begin
  if v_actor is null then
    raise exception 'admin_list_audit_log: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_list_audit_log: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_action := '%' || coalesce(_action_filter, '') || '%';
  v_target := coalesce(_target_type, '');

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
  from (
    select
      al.id,
      al.actor_id,
      al.action,
      al.target_type,
      al.target_id,
      al.details,
      al.created_at,
      p.display_name as actor_name
    from public.audit_log al
    left join public.profiles p on p.id = al.actor_id
    where al.action ilike v_action
      and (v_target = '' or al.target_type = v_target)
    order by al.created_at desc
    limit greatest(_limit, 1)
    offset greatest(_offset, 0)
  ) t;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_list_audit_log(text, text, int, int) to authenticated;

-- ============================================
-- Settings — read all + update (money subset owner-only)
-- ============================================
-- Keys that only the owner can change. Everything else is support +
-- owner writable.
create or replace function public.admin_settings_get_all()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_settings_get_all: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_settings_get_all: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(s) order by s.key), '[]'::jsonb) into v_rows
  from (
    select
      key, value, updated_by, updated_at,
      case when key in ('commission','payout_min_tokens','token_rate','payment_rates','jazzcash','easypaisa')
           then true else false end as is_money
    from public.settings
  ) s;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_settings_get_all() to authenticated;

create or replace function public.admin_settings_update(
  _key text,
  _value jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_is_money boolean;
begin
  if v_actor is null then
    raise exception 'admin_settings_update: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if _key is null or length(_key) < 1 then
    return jsonb_build_object('ok', false, 'code', 'bad_key');
  end if;
  if _value is null then
    return jsonb_build_object('ok', false, 'code', 'bad_value');
  end if;

  v_is_money := _key in ('commission','payout_min_tokens','token_rate','payment_rates','jazzcash','easypaisa');
  if v_is_money then
    if not public.user_has_role('owner') then
      raise exception 'admin_settings_update: owner required for money key'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not (public.user_has_role('support') or public.user_has_role('owner')) then
      raise exception 'admin_settings_update: support/owner required'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select value into v_old from public.settings where key = _key;
  if v_old is null then
    insert into public.settings (key, value, updated_by, updated_at)
      values (_key, _value, v_actor, now());
  else
    update public.settings
      set value = _value, updated_by = v_actor, updated_at = now()
      where key = _key;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'setting.update', 'setting', null,
    jsonb_build_object('key', _key, 'old', v_old, 'new', _value, 'is_money', v_is_money)
  );

  return jsonb_build_object('ok', true, 'key', _key, 'value', _value, 'is_money', v_is_money);
end;
$$;
grant execute on function public.admin_settings_update(text, jsonb) to authenticated;

-- ============================================
-- Banners — CRUD (support / owner)
-- ============================================
create or replace function public.admin_banner_create(
  _label text,
  _body text,
  _link text default null,
  _starts_at timestamptz default now(),
  _ends_at timestamptz default now() + interval '7 days'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'admin_banner_create: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_banner_create: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if length(_label) < 1 or length(_body) < 1 then
    return jsonb_build_object('ok', false, 'code', 'label_or_body_required');
  end if;
  if _ends_at <= _starts_at then
    return jsonb_build_object('ok', false, 'code', 'bad_window');
  end if;

  insert into public.banners (label, body, link, starts_at, ends_at, created_by)
    values (_label, _body, _link, _starts_at, _ends_at, v_actor)
    returning id into v_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'banner.create', 'banner', v_id, jsonb_build_object('label', _label));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
grant execute on function public.admin_banner_create(text, text, text, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_banner_update(
  _id uuid,
  _label text default null,
  _body text default null,
  _link text default null,
  _starts_at timestamptz default null,
  _ends_at timestamptz default null,
  _is_active boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'admin_banner_update: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_banner_update: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  update public.banners
    set label = coalesce(_label, label),
        body = coalesce(_body, body),
        link = coalesce(_link, link),
        starts_at = coalesce(_starts_at, starts_at),
        ends_at = coalesce(_ends_at, ends_at),
        is_active = coalesce(_is_active, is_active)
    where id = _id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'banner.update', 'banner', _id, jsonb_build_object());

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_banner_update(uuid, text, text, text, timestamptz, timestamptz, boolean) to authenticated;

create or replace function public.admin_banner_delete(_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'admin_banner_delete: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_banner_delete: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.banners where id = _id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'banner.delete', 'banner', _id, jsonb_build_object());

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_banner_delete(uuid) to authenticated;

-- ============================================
-- Announcements — CRUD (support / owner)
-- ============================================
create or replace function public.admin_announcement_create(
  _title text,
  _body text,
  _is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'admin_announcement_create: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_announcement_create: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if length(_title) < 1 or length(_body) < 1 then
    return jsonb_build_object('ok', false, 'code', 'title_or_body_required');
  end if;

  insert into public.announcements (title, body, is_active, posted_by)
    values (_title, _body, coalesce(_is_active, true), v_actor)
    returning id into v_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'announcement.create', 'announcement', v_id, jsonb_build_object('title', _title));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
grant execute on function public.admin_announcement_create(text, text, boolean) to authenticated;

create or replace function public.admin_announcement_update(
  _id uuid,
  _title text default null,
  _body text default null,
  _is_active boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'admin_announcement_update: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_announcement_update: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  update public.announcements
    set title = coalesce(_title, title),
        body = coalesce(_body, body),
        is_active = coalesce(_is_active, is_active)
    where id = _id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'announcement.update', 'announcement', _id, jsonb_build_object());

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_announcement_update(uuid, text, text, boolean) to authenticated;

create or replace function public.admin_announcement_delete(_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'admin_announcement_delete: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_announcement_delete: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.announcements where id = _id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_actor, 'announcement.delete', 'announcement', _id, jsonb_build_object());

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_announcement_delete(uuid) to authenticated;

-- ============================================
-- Token packs — toggle active (support); full update (owner only via
-- separate RPC or direct DB).
-- ============================================
create or replace function public.admin_token_packs_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_token_packs_list: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_token_packs_list: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order, t.created_at), '[]'::jsonb)
    into v_rows
  from (
    select id, label, price_pkr, tokens, is_active, sort_order, created_at
    from public.token_packs
  ) t;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_token_packs_list() to authenticated;

create or replace function public.admin_token_pack_set_active(
  _id uuid,
  _active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'admin_token_pack_set_active: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_token_pack_set_active: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  update public.token_packs
    set is_active = coalesce(_active, true)
    where id = _id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'token_pack.active', 'token_pack', _id,
    jsonb_build_object('active', coalesce(_active, true))
  );

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_token_pack_set_active(uuid, boolean) to authenticated;

create or replace function public.admin_token_pack_set_price(
  _id uuid,
  _price_pkr int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old int;
begin
  if v_actor is null then
    raise exception 'admin_token_pack_set_price: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('owner') then
    raise exception 'admin_token_pack_set_price: owner required'
      using errcode = 'insufficient_privilege';
  end if;
  if _price_pkr is null or _price_pkr <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_price');
  end if;

  select price_pkr into v_old from public.token_packs where id = _id;
  if v_old is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.token_packs set price_pkr = _price_pkr where id = _id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'token_pack.price', 'token_pack', _id,
    jsonb_build_object('old', v_old, 'new', _price_pkr)
  );

  return jsonb_build_object('ok', true, 'old', v_old, 'new', _price_pkr);
end;
$$;
grant execute on function public.admin_token_pack_set_price(uuid, int) to authenticated;

-- ============================================
-- Payment details — JazzCash / Easypaisa (support editable, owner too)
-- Already keyed in `settings` as `jazzcash` / `easypaisa` JSON blobs.
-- ============================================
create or replace function public.admin_payment_details_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_jazz jsonb;
  v_easy jsonb;
begin
  if v_actor is null then
    raise exception 'admin_payment_details_get: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_payment_details_get: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select value into v_jazz from public.settings where key = 'jazzcash';
  select value into v_easy from public.settings where key = 'easypaisa';
  return jsonb_build_object(
    'jazzcash', coalesce(v_jazz, '{}'::jsonb),
    'easypaisa', coalesce(v_easy, '{}'::jsonb)
  );
end;
$$;
grant execute on function public.admin_payment_details_get() to authenticated;

-- Update JazzCash / Easypaisa payment details through the existing
-- settings row. Both providers are owner-only via the is_money
-- gate in admin_settings_update — this RPC just gives a typed
-- convenience wrapper.
create or replace function public.admin_payment_details_update(
  _provider text,
  _account_name text default null,
  _account_number text default null,
  _instructions text default null,
  _qr_data_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_key text;
  v_old jsonb;
  v_new jsonb;
begin
  if v_actor is null then
    raise exception 'admin_payment_details_update: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if _provider not in ('jazzcash','easypaisa') then
    return jsonb_build_object('ok', false, 'code', 'bad_provider');
  end if;
  if not public.user_has_role('owner') then
    raise exception 'admin_payment_details_update: owner required'
      using errcode = 'insufficient_privilege';
  end if;

  v_key := _provider;
  select value into v_old from public.settings where key = v_key;

  v_new := coalesce(v_old, '{}'::jsonb)
    || jsonb_build_object(
      'account_name', coalesce(_account_name, v_old ->> 'account_name'),
      'account_number', coalesce(_account_number, v_old ->> 'account_number'),
      'instructions', coalesce(_instructions, v_old ->> 'instructions'),
      'qr_data_url', coalesce(_qr_data_url, v_old ->> 'qr_data_url')
    );

  if v_old is null then
    insert into public.settings (key, value, updated_by, updated_at)
      values (v_key, v_new, v_actor, now());
  else
    update public.settings set value = v_new, updated_by = v_actor, updated_at = now()
      where key = v_key;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'payment_details.update', 'setting', null,
    jsonb_build_object('provider', _provider, 'old', v_old, 'new', v_new)
  );

  return jsonb_build_object('ok', true, 'provider', _provider, 'value', v_new);
end;
$$;
grant execute on function public.admin_payment_details_update(text, text, text, text, text) to authenticated;

-- ============================================
-- Categories — list + update (support / owner)
-- ============================================
create or replace function public.admin_categories_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_categories_list: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_categories_list: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(c) order by c.sort_order, c.name), '[]'::jsonb)
    into v_rows
  from (
    select id, name, slug, icon, sort_order, is_active, created_at
    from public.categories
  ) c;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_categories_list() to authenticated;

create or replace function public.admin_category_update(
  _id uuid,
  _name text default null,
  _icon text default null,
  _sort_order int default null,
  _is_active boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.categories;
begin
  if v_actor is null then
    raise exception 'admin_category_update: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('support') or public.user_has_role('owner')) then
    raise exception 'admin_category_update: support/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from public.categories where id = _id;
  if v_old.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.categories
    set name = coalesce(_name, name),
        icon = coalesce(_icon, icon),
        sort_order = coalesce(_sort_order, sort_order),
        is_active = coalesce(_is_active, is_active)
    where id = _id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    v_actor, 'category.update', 'category', _id,
    jsonb_build_object('diff', jsonb_build_object(
      'name', jsonb_build_object('before', v_old.name, 'after', coalesce(_name, v_old.name)),
      'is_active', jsonb_build_object('before', v_old.is_active, 'after', coalesce(_is_active, v_old.is_active))
    ))
  );

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_category_update(uuid, text, text, int, boolean) to authenticated;

-- ============================================
-- Banners list + announcements list (read helpers)
-- ============================================
create or replace function public.admin_banners_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_banners_list: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_banners_list: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(b) order by b.starts_at desc), '[]'::jsonb)
    into v_rows
  from (
    select id, label, body, link, starts_at, ends_at, is_active, created_at
    from public.banners
  ) b;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_banners_list() to authenticated;

create or replace function public.admin_announcements_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_announcements_list: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_announcements_list: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(a) order by a.posted_at desc), '[]'::jsonb)
    into v_rows
  from (
    select id, title, body, is_active, posted_at
    from public.announcements
  ) a;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_announcements_list() to authenticated;

-- ============================================
-- Sellers list (approved sellers — for the seller management section)
-- ============================================
create or replace function public.admin_sellers_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_sellers_list: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_sellers_list: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(s) order by s.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      sp.id as seller_id,
      sp.user_id,
      sp.slug,
      sp.display_name,
      sp.is_verified,
      sp.is_active,
      sp.soft_deleted_at,
      sp.created_at,
      p.is_banned,
      p.soft_deleted_at as user_soft_deleted_at
    from public.seller_profiles sp
    join public.profiles p on p.id = sp.user_id
    where sp.soft_deleted_at is null
  ) s;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_sellers_list() to authenticated;

-- ============================================
-- Top-ups list (finance / owner)
-- ============================================
create or replace function public.admin_topups_list(_statuses text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_topups_list: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.user_has_role('finance') or public.user_has_role('owner')) then
    raise exception 'admin_topups_list: finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      tr.id, tr.user_id, tr.method, tr.token_pack_id, tr.amount_pkr, tr.tokens,
      tr.status, tr.reference_code, tr.sender_number, tr.transaction_id,
      tr.payment_id, tr.expires_at, tr.created_at,
      tr.reviewed_by, tr.reviewed_at, tr.review_note
    from public.topup_requests tr
    where (_statuses is null or tr.status = any(_statuses))
    order by tr.created_at desc
    limit 200
  ) t;

  return jsonb_build_object('rows', v_rows);
end;
$$;
grant execute on function public.admin_topups_list(text[]) to authenticated;

-- ============================================
-- Dashboard charts (small time-series)
-- ============================================
create or replace function public.admin_dashboard_charts(_window text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_days int := 30;
  v_new_users jsonb := '[]'::jsonb;
  v_bookings jsonb := '[]'::jsonb;
  v_revenue jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'admin_dashboard_charts: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_dashboard_charts: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  if _window = '7d' then v_days := 7;
  elsif _window = '90d' then v_days := 90;
  else v_days := 30;
  end if;

  select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb) into v_new_users
  from (
    select date_trunc('day', created_at)::date as day, count(*)::int as count
    from public.profiles
    where created_at >= now() - make_interval(days => v_days)
    group by 1
  ) d;

  select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb) into v_bookings
  from (
    select date_trunc('day', created_at)::date as day, count(*)::int as count
    from public.bookings
    where created_at >= now() - make_interval(days => v_days)
    group by 1
  ) d;

  select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb) into v_revenue
  from (
    select date_trunc('day', released_at)::date as day,
           coalesce(sum(price_tokens), 0)::int as tokens
    from public.bookings
    where status = 'released'
      and released_at >= now() - make_interval(days => v_days)
    group by 1
  ) d;

  return jsonb_build_object(
    'window_days', v_days,
    'new_users', v_new_users,
    'bookings', v_bookings,
    'revenue_tokens', v_revenue
  );
end;
$$;
grant execute on function public.admin_dashboard_charts(text) to authenticated;

-- ============================================
-- Reports (booking funnel + top sellers + dispute rate)
-- ============================================
create or replace function public.admin_reports_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_funnel jsonb := '{}'::jsonb;
  v_top_sellers jsonb := '[]'::jsonb;
  v_dispute_rate numeric := 0;
  v_total_30d int := 0;
begin
  if v_actor is null then
    raise exception 'admin_reports_overview: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.user_has_role('support')
    or public.user_has_role('finance')
    or public.user_has_role('owner')
  ) then
    raise exception 'admin_reports_overview: support/finance/owner required'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'paid', (select count(*) from public.bookings where status = 'paid'),
    'scheduled', (select count(*) from public.bookings where status = 'scheduled'),
    'live', (select count(*) from public.bookings where status = 'live'),
    'completed', (select count(*) from public.bookings where status = 'completed'),
    'released', (select count(*) from public.bookings where status = 'released'),
    'disputed', (select count(*) from public.bookings where status = 'disputed'),
    'cancelled', (select count(*) from public.bookings where status = 'cancelled'),
    'seller_no_show', (select count(*) from public.bookings where status = 'seller_no_show')
  ) into v_funnel;

  select count(*) into v_total_30d
    from public.bookings where created_at >= now() - interval '30 days';
  if v_total_30d > 0 then
    select (count(*) filter (where status = 'disputed')::numeric / v_total_30d)
      into v_dispute_rate
    from public.bookings where created_at >= now() - interval '30 days';
  end if;

  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into v_top_sellers
  from (
    select
      sp.user_id as seller_id,
      sp.display_name,
      sp.slug,
      count(bk.id)::int as released_count_30d,
      coalesce(sum(bk.price_tokens), 0)::int as released_tokens_30d
    from public.seller_profiles sp
    left join public.bookings bk on bk.seller_id = sp.user_id
      and bk.status = 'released'
      and bk.released_at >= now() - interval '30 days'
    where sp.soft_deleted_at is null
    group by sp.user_id, sp.display_name, sp.slug
    order by released_tokens_30d desc, released_count_30d desc
    limit 10
  ) s;

  return jsonb_build_object(
    'funnel', v_funnel,
    'top_sellers_30d', v_top_sellers,
    'dispute_rate_30d', v_dispute_rate,
    'bookings_total_30d', v_total_30d
  );
end;
$$;
grant execute on function public.admin_reports_overview() to authenticated;