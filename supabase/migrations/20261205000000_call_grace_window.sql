-- Call grace window: both parties can still start the call up to 60
-- minutes after the slot ends (slightly-late starts were impossible:
-- "Call ended" the second the window closed). Keep the 60-minute value
-- in sync with src/lib/call-window.ts.

create or replace function public.mint_livekit_token(_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings;
  v_slot public.availability_slots;
  v_url text;
  v_role text;
  v_effective_end timestamptz;
begin
  if v_actor is null then
    raise exception 'mint_livekit_token: sign in required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_booking
  from public.bookings where id = _booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_actor = v_booking.buyer_id then
    v_role := 'buyer';
  elsif v_actor = v_booking.seller_id then
    v_role := 'seller';
  else
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;

  if v_booking.status not in ('paid', 'scheduled', 'live') then
    return jsonb_build_object('ok', false, 'code', 'wrong_state',
      'status', v_booking.status);
  end if;

  select * into v_slot from public.availability_slots where id = v_booking.slot_id;
  if v_slot.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if now() < v_slot.starts_at - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'too_early',
      'starts_at', v_slot.starts_at,
      'opens_at', v_slot.starts_at - interval '5 minutes');
  end if;

  -- Grace: starts remain possible until 60 minutes after the slot end.
  v_effective_end := v_slot.ends_at + interval '60 minutes';
  if now() > v_effective_end then
    return jsonb_build_object('ok', false, 'code', 'too_late',
      'ends_at', v_slot.ends_at,
      'grace_ends_at', v_effective_end);
  end if;

  select value #>>'{}' into v_url from public.settings where key = 'livekit_url';

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'room_name', coalesce(v_booking.livekit_room, v_booking.id::text),
    'url', coalesce(v_url, ''),
    -- Effective end (incl. grace) so the room/token live until then.
    'ends_at', v_effective_end,
    'role', v_role,
    'identity', v_actor
  );
end $function$;
