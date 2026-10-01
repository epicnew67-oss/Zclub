-- StripClub — seller listings: status workflow, photos, slots, admin
-- moderation, and audit_log before/after diffs.

-- ============================================================ enum

create type public.listing_status as enum (
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'unpublished'
);

-- ============================================================ listings

alter table public.listings
  add column if not exists status public.listing_status not null default 'draft',
  add column if not exists submitted_for_review_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists unpublished_reason text;

create index if not exists listings_seller_status_idx
  on public.listings (seller_id, status);
create index if not exists listings_status_submitted_idx
  on public.listings (status, submitted_for_review_at);

-- ============================================================ photos

create table if not exists public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  path text not null,
  sort_order integer not null default 0,
  uploaded_at timestamptz not null default now(),
  unique (listing_id, path)
);
create index if not exists listing_photos_listing_sort_idx
  on public.listing_photos (listing_id, sort_order);

alter table public.listing_photos enable row level security;

-- Owner-or-admin/finance/support can select.
drop policy if exists "listing_photos_select_own_or_admin" on public.listing_photos;
create policy "listing_photos_select_own_or_admin"
  on public.listing_photos for select
  using (
    exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id
        and (
          sp.user_id = auth.uid()
          or public.user_has_role('support'::public.user_role)
          or public.user_has_role('finance'::public.user_role)
          or public.user_has_role('owner'::public.user_role)
        )
    )
  );

-- Owner can insert/update.
drop policy if exists "listing_photos_write_own" on public.listing_photos;
create policy "listing_photos_write_own"
  on public.listing_photos for insert
  with check (
    exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id
        and sp.user_id = auth.uid()
    )
  );
create policy "listing_photos_update_own"
  on public.listing_photos for update
  using (
    exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id
        and sp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id
        and sp.user_id = auth.uid()
    )
  );
-- Owners can delete their own listing photos (soft-delete-only rule
-- applies to the listing row, not to its photo rows).
create policy "listing_photos_delete_own"
  on public.listing_photos for delete
  using (
    exists (
      select 1 from public.listings l
      join public.seller_profiles sp on sp.id = l.seller_id
      where l.id = listing_photos.listing_id
        and sp.user_id = auth.uid()
    )
  );

-- ============================================================ storage

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', false)
on conflict (id) do nothing;

drop policy if exists "listing_photos_storage_insert_own" on storage.objects;
create policy "listing_photos_storage_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing_photos_storage_select_own_or_admin" on storage.objects;
create policy "listing_photos_storage_select_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.user_has_role('support'::public.user_role)
      or public.user_has_role('finance'::public.user_role)
      or public.user_has_role('owner'::public.user_role)
    )
  );

drop policy if exists "listing_photos_storage_update_own" on storage.objects;
create policy "listing_photos_storage_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing_photos_storage_delete_own" on storage.objects;
create policy "listing_photos_storage_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================ realtime

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.listings';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ============================================================ RPC: submit for review

create or replace function public.submit_listing_for_review(_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.listings;
  v_photo_count integer;
begin
  if v_user is null then
    raise exception 'submit_listing_for_review: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select l.* into v_row
  from public.listings l
  join public.seller_profiles sp on sp.id = l.seller_id
  where l.id = _listing_id
  for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_row.soft_deleted_at is not null then
    raise exception 'Listing is deleted' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.seller_profiles
    where id = v_row.seller_id and user_id = v_user
  ) then
    raise exception 'submit_listing_for_review: not the listing owner'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.status not in ('draft', 'rejected') then
    raise exception 'Cannot submit listing in status %', v_row.status
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(v_row.title, ''))) < 3 then
    raise exception 'Title must be at least 3 characters'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(v_row.description, ''))) < 10 then
    raise exception 'Description must be at least 10 characters'
      using errcode = 'check_violation';
  end if;
  if v_row.category_id is null then
    raise exception 'Category is required' using errcode = 'check_violation';
  end if;
  if v_row.duration_minutes is null or v_row.duration_minutes < 5 or v_row.duration_minutes > 240 then
    raise exception 'Duration must be 5–240 minutes' using errcode = 'check_violation';
  end if;
  if v_row.price_tokens is null or v_row.price_tokens <= 0 then
    raise exception 'Price must be greater than zero' using errcode = 'check_violation';
  end if;

  select count(*) into v_photo_count
  from public.listing_photos
  where listing_id = v_row.id;
  if v_photo_count < 1 then
    raise exception 'At least one photo is required' using errcode = 'check_violation';
  end if;

  update public.listings
  set status = 'pending_review',
      submitted_for_review_at = now(),
      reviewed_by = null,
      reviewed_at = null,
      review_note = null
  where id = v_row.id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.submit_listing_for_review(uuid) from public, anon;
grant execute on function public.submit_listing_for_review(uuid) to authenticated;

-- ============================================================ RPC: approve

create or replace function public.approve_listing(
  _listing_id uuid,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_row public.listings;
  v_owner uuid;
begin
  if v_reviewer is null then
    raise exception 'approve_listing: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('support'::public.user_role)
     and not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'approve_listing: support, finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.listings where id = _listing_id for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_row.status <> 'pending_review' then
    raise exception 'Listing is not pending review (status: %)', v_row.status
      using errcode = 'check_violation';
  end if;

  select sp.user_id into v_owner
  from public.seller_profiles sp where sp.id = v_row.seller_id;

  update public.listings
  set status = 'approved',
      reviewed_by = v_reviewer,
      reviewed_at = now(),
      review_note = null,
      unpublished_reason = null
  where id = v_row.id;

  insert into public.notifications (user_id, type, title, body, link)
  values (v_owner, 'system', 'Listing approved',
          coalesce(nullif(btrim(_note), ''), 'Your listing is live for buyers.'),
          '/seller/listings');

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'listing.approve', 'listing', v_row.id,
          jsonb_build_object(
            'note', _note,
            'diff', jsonb_build_object('status',
              jsonb_build_object('before', 'pending_review', 'after', 'approved'))
          ));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.approve_listing(uuid, text) from public, anon;
grant execute on function public.approve_listing(uuid, text) to authenticated;

-- ============================================================ RPC: reject

create or replace function public.reject_listing(
  _listing_id uuid,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_row public.listings;
  v_owner uuid;
  v_reason text;
begin
  if v_reviewer is null then
    raise exception 'reject_listing: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('support'::public.user_role)
     and not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'reject_listing: support, finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;
  v_reason := btrim(coalesce(_reason, ''));
  if char_length(v_reason) < 10 then
    raise exception 'Rejection reason must be at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into v_row from public.listings where id = _listing_id for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_row.status <> 'pending_review' then
    raise exception 'Listing is not pending review (status: %)', v_row.status
      using errcode = 'check_violation';
  end if;

  select sp.user_id into v_owner
  from public.seller_profiles sp where sp.id = v_row.seller_id;

  update public.listings
  set status = 'rejected',
      reviewed_by = v_reviewer,
      reviewed_at = now(),
      review_note = v_reason
  where id = v_row.id;

  insert into public.notifications (user_id, type, title, body, link)
  values (v_owner, 'system', 'Listing rejected', v_reason, '/seller/listings');

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'listing.reject', 'listing', v_row.id,
          jsonb_build_object(
            'reason', v_reason,
            'diff', jsonb_build_object(
              'status', jsonb_build_object('before', 'pending_review', 'after', 'rejected'),
              'review_note', jsonb_build_object('before', null, 'after', v_reason)
            )
          ));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.reject_listing(uuid, text) from public, anon;
grant execute on function public.reject_listing(uuid, text) to authenticated;

-- ============================================================ RPC: edit (admin)

create or replace function public.edit_listing(
  _listing_id uuid,
  _patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_row public.listings;
  v_owner uuid;
  v_patch jsonb := coalesce(_patch, '{}'::jsonb);
  v_diff jsonb := '{}'::jsonb;
  v_title text;
  v_description text;
  v_category_id uuid;
  v_duration integer;
  v_price integer;
begin
  if v_reviewer is null then
    raise exception 'edit_listing: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('support'::public.user_role)
     and not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'edit_listing: support, finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.listings where id = _listing_id for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id
      using errcode = 'foreign_key_violation';
  end if;

  v_title := v_row.title;
  v_description := v_row.description;
  v_category_id := v_row.category_id;
  v_duration := v_row.duration_minutes;
  v_price := v_row.price_tokens;

  if v_patch ? 'title' then
    v_title := btrim(v_patch->>'title');
    if char_length(v_title) < 3 or char_length(v_title) > 120 then
      raise exception 'Title must be 3–120 characters' using errcode = 'check_violation';
    end if;
  end if;
  if v_patch ? 'description' then
    v_description := btrim(v_patch->>'description');
  end if;
  if v_patch ? 'category_id' then
    v_category_id := (v_patch->>'category_id')::uuid;
    if v_category_id is null or not exists (select 1 from public.categories where id = v_category_id) then
      raise exception 'Invalid category' using errcode = 'check_violation';
    end if;
  end if;
  if v_patch ? 'duration_minutes' then
    v_duration := (v_patch->>'duration_minutes')::integer;
    if v_duration < 5 or v_duration > 240 then
      raise exception 'Duration must be 5–240 minutes' using errcode = 'check_violation';
    end if;
  end if;
  if v_patch ? 'price_tokens' then
    v_price := (v_patch->>'price_tokens')::integer;
    if v_price <= 0 then
      raise exception 'Price must be greater than zero' using errcode = 'check_violation';
    end if;
  end if;

  -- Build before/after diff of ONLY the fields that actually changed.
  if v_title is distinct from v_row.title then
    v_diff := v_diff || jsonb_build_object('title',
      jsonb_build_object('before', v_row.title, 'after', v_title));
  end if;
  if v_description is distinct from v_row.description then
    v_diff := v_diff || jsonb_build_object('description',
      jsonb_build_object('before', v_row.description, 'after', v_description));
  end if;
  if v_category_id is distinct from v_row.category_id then
    v_diff := v_diff || jsonb_build_object('category_id',
      jsonb_build_object('before', v_row.category_id, 'after', v_category_id));
  end if;
  if v_duration is distinct from v_row.duration_minutes then
    v_diff := v_diff || jsonb_build_object('duration_minutes',
      jsonb_build_object('before', v_row.duration_minutes, 'after', v_duration));
  end if;
  if v_price is distinct from v_row.price_tokens then
    v_diff := v_diff || jsonb_build_object('price_tokens',
      jsonb_build_object('before', v_row.price_tokens, 'after', v_price));
  end if;

  if v_diff = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.listings
  set title = v_title,
      description = v_description,
      category_id = v_category_id,
      duration_minutes = v_duration,
      price_tokens = v_price
  where id = v_row.id;

  select sp.user_id into v_owner
  from public.seller_profiles sp where sp.id = v_row.seller_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'listing.edit', 'listing', v_row.id,
          jsonb_build_object('diff', v_diff));

  return jsonb_build_object('ok', true, 'changed', true);
end $$;

revoke all on function public.edit_listing(uuid, jsonb) from public, anon;
grant execute on function public.edit_listing(uuid, jsonb) to authenticated;

-- ============================================================ RPC: unpublish

create or replace function public.unpublish_listing(
  _listing_id uuid,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.listings;
  v_is_admin boolean;
  v_owner uuid;
  v_reason text := btrim(coalesce(_reason, ''));
begin
  if v_user is null then
    raise exception 'unpublish_listing: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.listings where id = _listing_id for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id
      using errcode = 'foreign_key_violation';
  end if;

  v_is_admin := public.user_has_role('support'::public.user_role)
                or public.user_has_role('finance'::public.user_role)
                or public.user_has_role('owner'::public.user_role);

  select sp.user_id into v_owner
  from public.seller_profiles sp where sp.id = v_row.seller_id;

  if v_is_admin then
    if char_length(v_reason) < 10 then
      raise exception 'Admin unpublish requires a reason (≥10 characters)'
        using errcode = 'check_violation';
    end if;
  else
    if v_owner <> v_user then
      raise exception 'unpublish_listing: not the listing owner'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_row.status <> 'approved' then
    raise exception 'Only approved listings can be unpublished (status: %)',
      v_row.status using errcode = 'check_violation';
  end if;

  update public.listings
  set status = 'unpublished',
      unpublished_reason = v_reason
  where id = v_row.id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_user, 'listing.unpublish', 'listing', v_row.id,
          jsonb_build_object(
            'reason', nullif(v_reason, ''),
            'by_admin', v_is_admin,
            'diff', jsonb_build_object('status',
              jsonb_build_object('before', 'approved', 'after', 'unpublished'))
          ));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.unpublish_listing(uuid, text) from public, anon;
grant execute on function public.unpublish_listing(uuid, text) to authenticated;

-- ============================================================ RPC: add slot (with overlap check)

create or replace function public.add_listing_slot(
  _listing_id uuid,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _price_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.listings;
  v_owner uuid;
  v_new_id uuid;
  v_duration integer;
begin
  if v_user is null then
    raise exception 'add_listing_slot: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.listings where id = _listing_id for update;
  if v_row.id is null then
    raise exception 'Listing % not found', _listing_id
      using errcode = 'foreign_key_violation';
  end if;

  select sp.user_id into v_owner
  from public.seller_profiles sp where sp.id = v_row.seller_id;
  if v_owner <> v_user then
    raise exception 'add_listing_slot: not the listing owner'
      using errcode = 'insufficient_privilege';
  end if;

  if _ends_at <= _starts_at then
    raise exception 'Slot must end after it starts' using errcode = 'check_violation';
  end if;
  v_duration := (extract(epoch from (_ends_at - _starts_at)) / 60)::integer;
  if v_duration < 5 or v_duration > 240 then
    raise exception 'Slot duration must be 5–240 minutes' using errcode = 'check_violation';
  end if;
  if v_duration <> v_row.duration_minutes then
    raise exception 'Slot duration (% min) must match the listing duration (% min)',
      v_duration, v_row.duration_minutes using errcode = 'check_violation';
  end if;
  if _price_tokens is null or _price_tokens <= 0 then
    raise exception 'Price must be greater than zero' using errcode = 'check_violation';
  end if;

  -- Overlap check: any open slot on the same listing whose range intersects.
  if exists (
    select 1 from public.availability_slots
    where listing_id = v_row.id
      and status = 'open'
      and starts_at < _ends_at
      and ends_at > _starts_at
  ) then
    raise exception 'Slot overlaps an existing open slot' using errcode = 'check_violation';
  end if;

  insert into public.availability_slots (listing_id, starts_at, ends_at, price_tokens, status)
  values (v_row.id, _starts_at, _ends_at, _price_tokens, 'open')
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'slot_id', v_new_id);
end $$;

revoke all on function public.add_listing_slot(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.add_listing_slot(uuid, timestamptz, timestamptz, integer) to authenticated;

-- ============================================================ RPC: remove slot

create or replace function public.remove_listing_slot(_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_slot public.availability_slots;
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'remove_listing_slot: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_slot
  from public.availability_slots s
  join public.listings l on l.id = s.listing_id
  join public.seller_profiles sp on sp.id = l.seller_id
  where s.id = _slot_id
  for update;
  if v_slot.id is null then
    raise exception 'Slot % not found', _slot_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_slot.status <> 'open' then
    raise exception 'Only open slots can be removed (status: %)', v_slot.status
      using errcode = 'check_violation';
  end if;
  v_owner := (
    select sp.user_id from public.seller_profiles sp
    join public.listings l on l.seller_id = sp.id
    where l.id = v_slot.listing_id
  );
  if v_owner <> v_user then
    raise exception 'remove_listing_slot: not the listing owner'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.availability_slots where id = v_slot.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.remove_listing_slot(uuid) from public, anon;
grant execute on function public.remove_listing_slot(uuid) to authenticated;