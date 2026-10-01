-- Notifications + PWA push subscriptions.
--
-- Adds the push_subscriptions table for Web Push (VAPID) and a small
-- notify_role() helper that fans a notification out to every user that
-- holds a given role. The in-app bell + Realtime subscription on the
-- `notifications` table was already in place; this migration closes the
-- "how do admins hear about a new top-up / dispute / seller
-- application" gap by inserting one row per role-holder server-side
-- (in the same transaction as the originating action), so the bell +
-- push fan-out both pick it up.
--
-- RLS keeps push_subscriptions owner-only on insert / delete / select
-- (so a stolen token can't enumerate other users' endpoints) while
-- the service role can still read them for the fan-out helper.

-- ============================================================ table

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- ============================================================ RLS

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_owner_select on public.push_subscriptions;
create policy push_subscriptions_owner_select on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_owner_insert on public.push_subscriptions;
create policy push_subscriptions_owner_insert on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_owner_update on public.push_subscriptions;
create policy push_subscriptions_owner_update on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_owner_delete on public.push_subscriptions;
create policy push_subscriptions_owner_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================ notify_role helper

-- Fans a notification out to every user that holds one of the given
-- roles. Used by the JS layer to alert admins / finance on top-ups,
-- disputes, and seller applications. SECURITY DEFINER so it can read
-- across profiles. Idempotent: skips (user_id, type, target_link) tuples
-- already present so retries don't duplicate.
create or replace function public.notify_role(
  _roles text[],
  _type public.notification_type,
  _title text,
  _body text,
  _link text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if _roles is null or array_length(_roles, 1) is null then
    return 0;
  end if;

  with targets as (
    select ur.user_id
    from public.user_roles ur
    where ur.role::text = any (_roles)
  ),
  inserted as (
    insert into public.notifications (user_id, type, title, body, link)
    select t.user_id, _type, _title, _body, _link
    from targets t
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = t.user_id
        and n.type = _type
        and coalesce(n.link, '') = coalesce(_link, '')
        and n.title = _title
        and n.created_at > now() - interval '5 minutes'
    )
    returning 1 as x
  )
  select count(*) into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.notify_role(text[], public.notification_type, text, text, text)
  to authenticated, service_role;

-- ============================================================ realtime

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'push_subscriptions'
  ) then
    alter publication supabase_realtime add table public.push_subscriptions;
  end if;
end
$$;
