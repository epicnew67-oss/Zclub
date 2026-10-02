-- Complete seller-attended calls after the 60-minute grace when a closing
-- webhook was not delivered. The existing cron invokes this function.
create or replace function public.settle_due_bookings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_no_show_minutes integer;
  v_release_hours integer;
  v_cutover timestamptz;
begin
  v_no_show_minutes := coalesce(
    ((public.get_setting('no_show_grace_minutes')::jsonb)->>'minutes')::integer, 10);
  v_release_hours := coalesce(
    ((public.get_setting('release_window_hours')::jsonb)->>'hours')::integer, 24);
  select (value #>> '{}')::timestamptz into v_cutover
    from public.settings where key = 'settlement_cutover';
  v_cutover := coalesce(v_cutover, now());

  for v_booking in
    select b.id from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status in ('paid', 'scheduled', 'live')
      and b.created_at >= v_cutover
      and b.seller_joined_at is null
      and s.starts_at <= now() - make_interval(mins => v_no_show_minutes)
    order by s.starts_at
    limit 200
  loop
    perform public.mark_no_show_refund(v_booking.id);
  end loop;

  -- A seller-attended room that never sent room_finished cannot stay live
  -- forever. Once the call window and grace have elapsed, complete it through
  -- the same locked, idempotent webhook RPC.
  for v_booking in
    select b.id from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'live'
      and b.created_at >= v_cutover
      and b.seller_joined_at is not null
      and s.ends_at + interval '60 minutes' <= now()
    order by s.ends_at
    limit 200
  loop
    perform public.livekit_webhook_apply(v_booking.id, 'room_finished', null, now());
  end loop;

  for v_booking in
    select b.id from public.bookings b
    where b.status = 'completed'
      and b.created_at >= v_cutover
      and b.live_ended_at <= now() - make_interval(hours => v_release_hours)
    order by b.live_ended_at
    limit 200
  loop
    perform public.release_escrow(v_booking.id);
  end loop;
end $$;

