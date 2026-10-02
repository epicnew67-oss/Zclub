-- Browser clients may read through RLS, but only a small allowlist of fields
-- may be written directly. Money and moderation state change through RPCs.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

grant update (time_zone) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;

-- The seller draft editor writes only these fields. Approval and visibility
-- remain exclusive to the audited moderation RPCs.
grant insert (seller_id, title, description, category_id, duration_minutes,
  price_tokens, status, is_active) on public.listings to authenticated;
grant update (title, description, category_id, duration_minutes,
  price_tokens) on public.listings to authenticated;
grant insert, delete on public.listing_photos to authenticated;

drop policy if exists listings_insert_own on public.listings;
create policy listings_insert_own on public.listings
  for insert to authenticated with check (
    status = 'draft' and is_active = false and soft_deleted_at is null
    and exists (
      select 1 from public.seller_profiles sp
      where sp.id = listings.seller_id and sp.user_id = auth.uid()
        and sp.is_active and sp.soft_deleted_at is null
    )
  );

drop policy if exists listings_update_own on public.listings;
create policy listings_update_own on public.listings
  for update to authenticated using (
    status in ('draft', 'rejected') and soft_deleted_at is null
    and exists (
      select 1 from public.seller_profiles sp
      where sp.id = listings.seller_id and sp.user_id = auth.uid()
        and sp.is_active and sp.soft_deleted_at is null
    )
  ) with check (
    status in ('draft', 'rejected') and soft_deleted_at is null
    and exists (
      select 1 from public.seller_profiles sp
      where sp.id = listings.seller_id and sp.user_id = auth.uid()
        and sp.is_active and sp.soft_deleted_at is null
    )
  );

drop policy if exists listing_photos_write_own on public.listing_photos;
create policy listing_photos_write_own on public.listing_photos
  for insert to authenticated with check (
    path like auth.uid()::text || '/%'
    and exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id and sp.user_id = auth.uid()
        and l.status in ('draft', 'rejected') and l.soft_deleted_at is null
    )
  );

drop policy if exists listing_photos_delete_own on public.listing_photos;
create policy listing_photos_delete_own on public.listing_photos
  for delete to authenticated using (
    exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id and sp.user_id = auth.uid()
        and l.status in ('draft', 'rejected') and l.soft_deleted_at is null
    )
  );

-- These old policies allowed writes that the client no longer needs.
drop policy if exists seller_profiles_update_own on public.seller_profiles;
drop policy if exists slots_insert_own on public.availability_slots;
drop policy if exists slots_update_own on public.availability_slots;
drop policy if exists listing_photos_update_own on public.listing_photos;

-- Service helpers take arbitrary user IDs or create trusted notifications.
-- They must not be callable from a browser's anon or authenticated key.
revoke all on function public.get_seller_wallet_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.get_seller_wallet_summary(uuid) to service_role;
revoke all on function public.release_escrow(uuid)
  from public, anon, authenticated;
grant execute on function public.release_escrow(uuid) to service_role;
revoke all on function public.notify_role(text[], public.notification_type, text, text, text)
  from public, anon, authenticated;
grant execute on function public.notify_role(text[], public.notification_type, text, text, text)
  to service_role;
revoke all on function public.get_setting(text) from public, anon, authenticated;
grant execute on function public.get_setting(text) to service_role;

-- Browser pages only need the withdrawal threshold. Server-side billing and
-- admin helpers use the service role for the other configuration values.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using (key = 'payout_min_tokens');

-- Serialize payout reservations for one wallet. Without this lock two tabs
-- could both observe the same available balance and reserve it twice.
create or replace function public.request_payout(_amount int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_min int;
  v_balance int;
  v_pending int;
  v_approved int;
  v_available int;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'request_payout: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.seller_profiles
    where user_id = v_actor and soft_deleted_at is null and is_active = true
  ) then
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

  -- This row is also locked by wallet debits/credits. The balance and pending
  -- reservations are read only after the lock is acquired.
  perform 1 from public.wallets where user_id = v_actor for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'wallet_missing');
  end if;
  v_balance := public.wallet_get_balance(v_actor);
  select coalesce(sum(tokens) filter (where status = 'pending'), 0),
         coalesce(sum(tokens) filter (where status = 'approved'), 0)
    into v_pending, v_approved
    from public.payout_requests where seller_id = v_actor;
  v_available := v_balance - v_pending - v_approved;
  if v_available < _amount then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_AVAILABLE',
      'have', v_available, 'need', _amount);
  end if;

  insert into public.payout_requests (seller_id, tokens, status)
  values (v_actor, _amount, 'pending') returning id into v_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (v_actor, 'payout', 'Payout request submitted',
    format('%s tokens requested.', _amount), '/wallet');
  return jsonb_build_object('ok', true, 'payout_id', v_id,
    'amount', _amount, 'available_after', v_available - _amount);
end;
$$;
