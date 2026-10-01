-- StripClub — seller application flow: avatar, display name, gender,
-- offering, terms agreement (version + IP + timestamp), 7-day reapply
-- cooldown, max 3 attempts, one pending at a time. Storage for avatars
-- and security-definer RPCs for submit / approve / reject.

-- ============================================================ columns

alter table public.seller_applications
  add column if not exists display_name text,
  add column if not exists gender text
    check (gender in ('male','female','non_binary','other','prefer_not_to_say')),
  add column if not exists offering text,
  add column if not exists avatar_url text,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_ip text,
  add column if not exists attempt_number integer not null default 1;

-- ============================================================ storage

insert into storage.buckets (id, name, public)
values ('seller-avatars', 'seller-avatars', false)
on conflict (id) do nothing;

drop policy if exists "seller_avatars_insert_own" on storage.objects;
create policy "seller_avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'seller-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "seller_avatars_select_own_or_admin" on storage.objects;
create policy "seller_avatars_select_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'seller-avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.user_has_role('support'::public.user_role)
      or public.user_has_role('finance'::public.user_role)
      or public.user_has_role('owner'::public.user_role)
    )
  );

drop policy if exists "seller_avatars_update_own" on storage.objects;
create policy "seller_avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'seller-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'seller-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================ settings

insert into public.settings (key, value)
values ('seller_terms_version',
        jsonb_build_object('version', 'v1', 'updated_at', now()::text))
on conflict (key) do nothing;

-- ============================================================ realtime

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.seller_applications';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ============================================================ RLS

drop policy if exists "seller_applications_select_admin" on public.seller_applications;
create policy "seller_applications_select_admin"
  on public.seller_applications for select
  using (
    public.user_has_role('support'::public.user_role)
    or public.user_has_role('finance'::public.user_role)
    or public.user_has_role('owner'::public.user_role)
  );

-- ============================================================ RPC: submit

create or replace function public.submit_seller_application(
  _display_name text,
  _gender text,
  _offering text,
  _avatar_url text,
  _terms_version text,
  _terms_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pending_count integer;
  v_rejected_recent timestamptz;
  v_attempts integer;
  v_avatar text;
begin
  if v_user is null then
    raise exception 'submit_seller_application: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  _display_name := btrim(_display_name);
  _offering := btrim(_offering);
  _gender := lower(btrim(coalesce(_gender, '')));

  if char_length(_display_name) < 2 or char_length(_display_name) > 80 then
    raise exception 'Display name must be 2–80 characters'
      using errcode = 'check_violation';
  end if;
  if _gender not in ('male','female','non_binary','other','prefer_not_to_say') then
    raise exception 'Invalid gender'
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(_offering,'')) < 10 or char_length(_offering) > 1000 then
    raise exception 'Tell us what you want to sell (10–1000 characters)'
      using errcode = 'check_violation';
  end if;
  if _terms_version is null or btrim(_terms_version) = '' then
    raise exception 'Terms version is required'
      using errcode = 'check_violation';
  end if;

  -- one pending at a time
  select count(*) into v_pending_count
  from public.seller_applications
  where user_id = v_user and status = 'pending';
  if v_pending_count > 0 then
    raise exception 'You already have a pending application'
      using errcode = 'check_violation';
  end if;

  -- max 3 attempts
  select count(*) into v_attempts
  from public.seller_applications
  where user_id = v_user;
  if v_attempts >= 3 then
    raise exception 'Maximum 3 seller applications reached'
      using errcode = 'check_violation';
  end if;

  -- 7-day cooldown after rejection (from reviewed_at)
  select reviewed_at into v_rejected_recent
  from public.seller_applications
  where user_id = v_user and status = 'rejected'
  order by reviewed_at desc nulls last
  limit 1;
  if v_rejected_recent is not null and v_rejected_recent > now() - interval '7 days' then
    raise exception 'Reapply cooldown: you can reapply on %', (v_rejected_recent + interval '7 days')::date
      using errcode = 'check_violation';
  end if;

  v_avatar := nullif(btrim(coalesce(_avatar_url,'')), '');

  insert into public.seller_applications (
    user_id, display_name, gender, offering, avatar_url,
    motivation, social_links,
    terms_version, terms_accepted_at, terms_ip,
    attempt_number, status
  ) values (
    v_user, _display_name, _gender, _offering, v_avatar,
    _offering, null,
    _terms_version, now(), _terms_ip,
    v_attempts + 1, 'pending'
  );

  return jsonb_build_object('ok', true, 'attempt', v_attempts + 1);
end $$;

revoke all on function public.submit_seller_application(text,text,text,text,text,text) from public, anon;
grant execute on function public.submit_seller_application(text,text,text,text,text,text) to authenticated;

-- ============================================================ RPC: approve

create or replace function public.approve_seller_application(
  _application_id uuid,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_app public.seller_applications;
  v_slug text;
  v_base_slug text;
  v_suffix integer := 0;
begin
  if v_reviewer is null then
    raise exception 'approve_seller_application: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('support'::public.user_role)
     and not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'approve_seller_application: support, finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_app from public.seller_applications where id = _application_id for update;
  if v_app.id is null then
    raise exception 'Application % not found', _application_id using errcode = 'foreign_key_violation';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already %', v_app.status using errcode = 'check_violation';
  end if;

  update public.seller_applications
  set status = 'approved', reviewed_by = v_reviewer, reviewed_at = now(), review_note = _note
  where id = v_app.id;

  -- grant seller role
  insert into public.user_roles (user_id, role, granted_by)
  values (v_app.user_id, 'seller', v_reviewer)
  on conflict (user_id, role) do nothing;

  -- ensure wallet exists (trigger creates one on signup, but be safe)
  insert into public.wallets (user_id) values (v_app.user_id)
  on conflict (user_id) do nothing;

  -- create seller_profile if missing; generate unique slug
  if not exists (select 1 from public.seller_profiles where user_id = v_app.user_id) then
    v_base_slug := lower(regexp_replace(v_app.display_name, '[^a-z0-9]+', '-', 'g'));
    v_base_slug := btrim(v_base_slug, '-');
    if v_base_slug = '' then v_base_slug := 'seller'; end if;
    v_slug := v_base_slug;
    while exists (select 1 from public.seller_profiles where slug = v_slug) loop
      v_suffix := v_suffix + 1;
      v_slug := v_base_slug || '-' || v_suffix;
    end loop;

    insert into public.seller_profiles (user_id, display_name, slug, avatar_url, bio, is_verified, is_active)
    values (v_app.user_id, v_app.display_name, v_slug, v_app.avatar_url, v_app.offering, false, true);
  else
    update public.seller_profiles
    set display_name = v_app.display_name,
        avatar_url = coalesce(v_app.avatar_url, avatar_url)
    where user_id = v_app.user_id;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (v_app.user_id, 'system', 'Seller application approved',
          'Welcome — your seller profile is live. Set up your listings to start selling.',
          '/seller');

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'seller_application.approve', 'seller_application', v_app.id,
          jsonb_build_object('note', _note, 'applicant', v_app.user_id));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.approve_seller_application(uuid,text) from public, anon;
grant execute on function public.approve_seller_application(uuid,text) to authenticated;

-- ============================================================ RPC: reject

create or replace function public.reject_seller_application(
  _application_id uuid,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_app public.seller_applications;
begin
  if v_reviewer is null then
    raise exception 'reject_seller_application: sign in required'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.user_has_role('support'::public.user_role)
     and not public.user_has_role('finance'::public.user_role)
     and not public.user_has_role('owner'::public.user_role) then
    raise exception 'reject_seller_application: support, finance or owner role required'
      using errcode = 'insufficient_privilege';
  end if;
  _reason := btrim(coalesce(_reason,''));
  if char_length(_reason) < 10 then
    raise exception 'Rejection reason must be at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into v_app from public.seller_applications where id = _application_id for update;
  if v_app.id is null then
    raise exception 'Application % not found', _application_id using errcode = 'foreign_key_violation';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already %', v_app.status using errcode = 'check_violation';
  end if;

  update public.seller_applications
  set status = 'rejected', reviewed_by = v_reviewer, reviewed_at = now(), review_note = _reason
  where id = v_app.id;

  insert into public.notifications (user_id, type, title, body, link)
  values (v_app.user_id, 'system', 'Seller application rejected', _reason, '/become-a-seller');

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (v_reviewer, 'seller_application.reject', 'seller_application', v_app.id,
          jsonb_build_object('reason', _reason, 'applicant', v_app.user_id));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.reject_seller_application(uuid,text) from public, anon;
grant execute on function public.reject_seller_application(uuid,text) to authenticated;
