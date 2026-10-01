/**
 * LiveKit webhook handler.
 *
 * LiveKit POSTs JSON events with an `Authorization` header carrying the
 * HMAC-SHA256(rawBody, apiSecret) digest. The `WebhookReceiver` from
 * `livekit-server-sdk` verifies the signature in constant time and
 * returns a parsed `WebhookEvent`.
 *
 * On `participant_joined` / `participant_left` / `room_finished` we
 * delegate to the `livekit_webhook_apply` RPC (service-role only) so
 * all state changes happen in one DB transaction inside Postgres.
 * Anything else is acknowledged with `200 OK` so LiveKit doesn't retry.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { livekitConfig, verifyWebhook } from "@/lib/livekit";

export const runtime = "nodejs";

// LiveKit webhook payloads are <10 KB in practice; cap defensively.
const MAX_WEBHOOK_BODY = 64 * 1024;

export async function POST(request: Request) {
  if (!livekitConfig()) {
    return Response.json(
      { error: "Webhook not configured" },
      { status: 501 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_WEBHOOK_BODY) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BODY) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const authHeader = request.headers.get("authorization");

  let event;
  try {
    event = await verifyWebhook(rawBody, authHeader);
  } catch (err) {
    return Response.json(
      { error: "Bad signature", detail: (err as Error).message },
      { status: 401 }
    );
  }

  // Map LiveKit's snake-cased event names to the strings our RPC
  // expects. Unknown events are still 200 — LiveKit should not retry.
  const mapped = mapEvent(event.event);
  if (!mapped) {
    return Response.json({ ok: true, ignored: event.event });
  }

  const roomName = event.room?.name;
  const participantIdentity = event.participant?.identity;
  if (!roomName) {
    return Response.json({ ok: true, ignored: "missing room.name" });
  }

  // The room name is the booking id (see LiveKitRoom initialization in
  // /api/call/[bookingId]). We can't trust the URL — we look the
  // booking up by id and reject unknown rooms.
  const admin = createAdminClient();
  const { data: booking, error: lookupErr } = await admin
    .from("bookings")
    .select("id")
    .eq("id", roomName)
    .maybeSingle();
  if (lookupErr) {
    console.error("livekit webhook booking lookup failed:", lookupErr);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
  if (!booking) {
    return Response.json({ ok: true, ignored: "unknown room" });
  }

  // participant_joined / participant_left carry the user identity which
  // is auth.uid() (we set it server-side when minting the token).
  // room_finished does not carry a participant; pass null.
  const userId =
    mapped === "room_finished" ? null : parseUuid(participantIdentity);

  const { data, error } = await admin.rpc("livekit_webhook_apply", {
    _booking_id: booking.id,
    _event_type: mapped,
    _user_id: userId,
  } as never);

  if (error) {
    console.error("livekit_webhook_apply failed:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  return Response.json(data ?? { ok: true });
}

function mapEvent(name: string): string | null {
  switch (name) {
    case "participant_joined":
    case "participant_left":
    case "room_finished":
      return name;
    default:
      return null;
  }
}

function parseUuid(s: string | undefined): string | null {
  if (!s) return null;
  // Loose UUID check; the RPC will return unknown_participant if it
  // doesn't match buyer_id/seller_id on the booking.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return s;
  }
  return null;
}