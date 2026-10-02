"use server";

import { RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { livekitConfig } from "@/lib/livekit";

/** Cross-check browser connection events with LiveKit before recording money-relevant state. */
export async function reconcileCallPresenceAction(bookingId: string, event: "joined" | "left") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId) || (event !== "joined" && event !== "left")) {
    return { ok: false, code: "invalid_request" };
  }
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { ok: false, code: "not_signed_in" };
  const admin = createAdminClient();
  const { data: booking } = await admin.from("bookings")
    .select("id,buyer_id,seller_id,livekit_room,status")
    .eq("id", bookingId).maybeSingle();
  if (!booking || (booking.buyer_id !== user.id && booking.seller_id !== user.id)) {
    return { ok: false, code: "not_participant" };
  }
  if (!["paid", "scheduled", "live"].includes(booking.status)) {
    return { ok: false, code: "wrong_state" };
  }
  const config = livekitConfig();
  if (!config) return { ok: false, code: "not_configured" };
  const service = new RoomServiceClient(config.url, config.apiKey, config.apiSecret);
  const room = booking.livekit_room || booking.id;
  try {
    if (event === "joined") {
      const participants = await service.listParticipants(room);
      if (!participants.some((participant) => participant.identity === user.id)) {
        return { ok: false, code: "not_connected" };
      }
      const { data, error } = await admin.rpc("livekit_webhook_apply", {
        _booking_id: booking.id, _event_type: "participant_joined", _user_id: user.id,
      });
      return error ? { ok: false, code: "database_error" } : { ok: data?.ok === true, code: data?.code ?? null };
    }
    const activeRooms = await service.listRooms([room]);
    if (activeRooms.length) {
      const participants = await service.listParticipants(room);
      if (participants.length) return { ok: true, code: "room_active" };
    }
    const { data, error } = await admin.rpc("livekit_webhook_apply", {
      _booking_id: booking.id, _event_type: "room_finished", _user_id: null,
    });
    return error ? { ok: false, code: "database_error" } : { ok: data?.ok === true, code: data?.code ?? null };
  } catch {
    return { ok: false, code: "provider_unavailable" };
  }
}
