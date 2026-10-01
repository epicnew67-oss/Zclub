/**
 * Server-only LiveKit helpers: access-token minting, webhook verification,
 * and room pre-creation with maxParticipants=2.
 *
 * The LiveKit API secret is read from `LIVEKIT_API_SECRET` env var and is
 * never exposed to the client. The server route `/call/[bookingId]` calls
 * `mintAccessToken` and returns the resulting JWT to the browser; the
 * client SDK uses it (along with the public URL) to connect.
 *
 * The webhook handler at `/api/webhooks/livekit` calls `verifyWebhook`
 * with the raw body + the `Authorization` header so we can refuse any
 * event that doesn't carry a valid HMAC-SHA256 signature.
 */
import "server-only";
import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function livekitConfig(): {
  url: string;
  apiKey: string;
  apiSecret: string;
} | null {
  const url = env("LIVEKIT_URL");
  const apiKey = env("LIVEKIT_API_KEY");
  const apiSecret = env("LIVEKIT_API_SECRET");
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export type AccessTokenArgs = {
  /** Stable per-user identity — use `auth.uid()` for the booking's buyer/seller. */
  identity: string;
  /** Room name (we use the booking id). */
  room: string;
  /** Display name shown to other participants. */
  name?: string;
  /** Seconds until the token expires. We pass `ttl = endsAt - now`. */
  ttlSeconds: number;
};

export async function mintAccessToken(args: AccessTokenArgs): Promise<string> {
  const cfg = livekitConfig();
  if (!cfg) throw new Error("LiveKit env not configured");
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: args.identity,
    name: args.name,
    ttl: args.ttlSeconds,
  });
  at.addGrant({
    room: args.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  });
  return at.toJwt();
}

/**
 * Pre-create the LiveKit room with `maxParticipants=2` so a third
 * caller cannot accidentally join. LiveKit returns the existing room
 * if it already exists — this is idempotent and safe to call on every
 * token mint. Failures are non-fatal (the token still works; the room
 * just won't have the cap applied for this session).
 */
export async function ensureCallRoom(roomName: string): Promise<void> {
  const cfg = livekitConfig();
  if (!cfg) return;
  const svc = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);
  try {
    await svc.createRoom({
      name: roomName,
      emptyTimeout: 10, // close empty rooms after 10 minutes
      maxParticipants: 2,
    });
  } catch {
    // Room already exists (or another transient error). The token still
    // grants roomJoin=true, so the caller can connect regardless.
  }
}

/**
 * Verify a LiveKit webhook signature. Returns the parsed event on
 * success, throws on bad signature. LiveKit signs the raw JSON body
 * with HMAC-SHA256(body, apiSecret) and passes it in the
 * `Authorization` header (hex digest, no scheme prefix).
 */
export async function verifyWebhook(
  rawBody: string,
  authHeader: string | null
): Promise<{
  event: string;
  room?: { name?: string };
  participant?: { identity?: string };
}> {
  const cfg = livekitConfig();
  if (!cfg) throw new Error("LiveKit env not configured");
  if (!authHeader) throw new Error("missing Authorization header");
  const receiver = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
  // The SDK accepts the body string + the header value and returns a
  // strongly-typed WebhookEvent with `event`, `room?.name`, and
  // `participant?.identity` populated.
  const event = await receiver.receive(rawBody, authHeader);
  return {
    event: event.event,
    room: event.room ? { name: event.room.name } : undefined,
    participant: event.participant ? { identity: event.participant.identity } : undefined,
  };
}