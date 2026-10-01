-- ============================================
-- Add 'release' value to notification_type enum
-- ============================================
-- release_escrow posts a notification to the seller on release; the
-- migration in 20261103000000_post_call_money.sql assumed 'release'
-- was already in the enum but only 'booking' / 'chat' / 'dispute' /
-- 'payout' / 'system' exist. Add it idempotently.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_type'
      and e.enumlabel = 'release'
  ) then
    alter type public.notification_type add value 'release';
  end if;
end $$;
