-- Emails for the top-up review queue. profiles has no email column
-- (auth.users is the source of truth), so expose a single service-role
-- helper that maps user ids → emails for the admin/finance queue.

create or replace function public.admin_user_emails(_user_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(u.id, u.email), '{}'::jsonb)
  from auth.users u
  where u.id = any(_user_ids);
$$;

revoke all on function public.admin_user_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_user_emails(uuid[]) to service_role;
