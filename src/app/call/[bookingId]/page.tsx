import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ensureCallRoom, livekitConfig, mintAccessToken } from "@/lib/livekit";
import {
  CALL_GRACE_MINUTES,
  CALL_OPENS_BEFORE_MINUTES,
} from "@/lib/call-window";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { CallRoom } from "./call-room";

type Params = { bookingId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { bookingId } = await params;
  return { title: `Call ${bookingId.slice(0, 8)}` };
}

type RpcResult =
  | {
      ok: true;
      booking_id: string;
      room_name: string;
      url: string;
      ends_at: string;
      role: "buyer" | "seller";
      identity: string;
    }
  | { ok: false; code: string; [k: string]: unknown };

export default async function CallPage({
  params,
}: {
  params: Promise<Params>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Almost there" subtitle="Supabase isn't configured.">
          <></>
        </AuthCard>
      </div>
    );
  }

  const { bookingId } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Sign in to join"
          subtitle="You need to be signed in as the buyer or seller of this booking."
        >
          <Button asChild className="mt-2 bg-burgundy text-foreground">
            <Link href={`/auth/sign-in?next=/call/${bookingId}`}>Sign in</Link>
          </Button>
        </AuthCard>
      </div>
    );
  }

  // Call the RPC as the user so auth.uid() resolves correctly.
  const { data, error } = await supabase.rpc("mint_livekit_token", {
    _booking_id: bookingId,
  } as never);

  const result = (data ?? null) as RpcResult | null;

  if (error || !result) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Could not start the call" subtitle={error?.message ?? "Unknown error"}>
          <Button asChild variant="outline" className="mt-2">
            <Link href={`/orders/${bookingId}`}>Back to order</Link>
          </Button>
        </AuthCard>
      </div>
    );
  }

  if (!result.ok) {
    const code = result.code;
    const title =
      code === "too_early"
        ? "The call hasn't opened"
        : code === "too_late"
          ? "The call window has passed"
          : code === "wrong_state"
            ? "This call isn't active"
            : code === "not_participant"
              ? "You're not part of this booking"
              : "Call not available";
    const subtitle =
      code === "too_early" && typeof result.opens_at === "string"
        ? `It opens at ${new Date(String(result.opens_at)).toLocaleString()} (${CALL_OPENS_BEFORE_MINUTES} minutes before the scheduled start).`
        : code === "too_late"
          ? `The scheduled call window has passed (a ${CALL_GRACE_MINUTES}-minute grace period is included).`
          : code === "wrong_state"
            ? `This booking is in status "${String(result.status ?? "")}". Calls are only available for paid / scheduled / live bookings.`
            : code === "not_participant"
              ? "Only the buyer and the seller of this booking can join the call."
              : "Please check the order details.";
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title={title} subtitle={subtitle}>
          <Button asChild variant="outline" className="mt-2">
            <Link href={`/orders/${bookingId}`}>Back to order</Link>
          </Button>
        </AuthCard>
      </div>
    );
  }

  if (!livekitConfig()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Live is not configured"
          subtitle="The site owner hasn't set the LiveKit API credentials yet."
        >
          <Button asChild variant="outline" className="mt-2">
            <Link href={`/orders/${bookingId}`}>Back to order</Link>
          </Button>
        </AuthCard>
      </div>
    );
  }

  // Pre-create the room with maxParticipants=2 (idempotent — silently
  // fails if the room already exists; the token still works).
  await ensureCallRoom(result.room_name);

  const ttlSeconds = Math.max(
    60,
    Math.min(86_400, Math.floor((new Date(result.ends_at).getTime() - Date.now()) / 1000))
  );

  const token = await mintAccessToken({
    identity: result.identity,
    room: result.room_name,
    name: result.role === "buyer" ? "Buyer" : "Seller",
    ttlSeconds,
  });

  return (
    <CallRoom
      token={token}
      url={result.url}
      roomName={result.room_name}
      role={result.role}
      endsAt={result.ends_at}
      bookingId={bookingId}
    />
  );
}