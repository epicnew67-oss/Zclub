"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CALL_GRACE_MINUTES,
  CALL_OPENS_BEFORE_MINUTES,
} from "@/lib/call-window";

/**
 * "Join call" button — appears in the order chat. Enabled from 5 minutes
 * before slot.starts_at through slot.ends_at, plus a grace period
 * (CALL_GRACE_MINUTES) so a slightly-late start still works. Disabled
 * otherwise with a tooltip explaining why.
 *
 * Opens `/call/<id>` in a new tab so the chat stays open alongside the
 * call. The call page itself does the server-side auth + token mint
 * against the same window.
 */
export function JoinCallButton({
  bookingId,
  slotStartsAt,
  slotEndsAt,
  status,
}: {
  bookingId: string;
  slotStartsAt: string;
  slotEndsAt: string;
  status: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Re-tick every 30s while mounted so the enabled/disabled boundary
  // flips at the right moment without a page refresh.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const start = new Date(slotStartsAt).getTime();
  const end = new Date(slotEndsAt).getTime();
  const opensAt = start - CALL_OPENS_BEFORE_MINUTES * 60_000;
  const graceEnd = end + CALL_GRACE_MINUTES * 60_000;
  const finalized = !["paid", "scheduled", "live"].includes(status);
  const canJoin = !finalized && now >= opensAt && now <= graceEnd;

  let label = "Join call";
  let disabledReason: string | null = null;
  if (finalized) {
    label = "Call ended";
    disabledReason = "This order is finalized.";
  } else if (now < opensAt) {
    const minutes = Math.max(1, Math.ceil((opensAt - now) / 60_000));
    label = `Opens in ${minutes} min`;
    disabledReason = `The call opens ${CALL_OPENS_BEFORE_MINUTES} minutes before the scheduled start.`;
  } else if (now > graceEnd) {
    label = "Call ended";
    disabledReason = "The scheduled call window has passed.";
  }

  if (canJoin) {
    return (
      <Button asChild size="sm" className="bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90">
        <Link href={`/call/${bookingId}`} target="_blank" rel="noopener noreferrer"
          prefetch={false} data-join-call="ready" title="Open the video call in a new tab">
          <VideoIcon className="mr-1.5 size-3.5" />
          Join call
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={canJoin ? "default" : "outline"}
      size="sm"
      disabled={!canJoin}
      title={disabledReason ?? "Open the video call in a new tab"}
      className={
        canJoin
          ? "bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90"
          : undefined
      }
      data-join-call={canJoin ? "ready" : "disabled"}
    >
      <VideoIcon className="mr-1.5 size-3.5" />
      {label}
    </Button>
  );

}
