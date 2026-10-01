"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Join call" button — appears in the order chat. Enabled from 5 minutes
 * before slot.starts_at through slot.ends_at (the booking's call
 * window). Disabled otherwise with a tooltip explaining why.
 *
 * Opens `/call/<id>` in a new tab so the chat stays open alongside the
 * call. The call page itself does the server-side auth + token mint
 * and redirects to an error message if the user is outside the window
 * server-side.
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
  const opensAt = start - 5 * 60_000;
  const finalized = status === "cancelled" || status === "seller_no_show" || status === "completed";
  const canJoin = !finalized && now >= opensAt && now <= end;

  let label = "Join call";
  let disabledReason: string | null = null;
  if (finalized) {
    label = "Call ended";
    disabledReason = "This order is finalized.";
  } else if (now < opensAt) {
    const minutes = Math.max(1, Math.ceil((opensAt - now) / 60_000));
    label = `Opens in ${minutes} min`;
    disabledReason = `The call opens 5 minutes before the scheduled start.`;
  } else if (now > end) {
    label = "Call ended";
    disabledReason = "The scheduled call window has passed.";
  }

  const button = (
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
      onClick={() => {
        if (!canJoin) return;
        window.open(`/call/${bookingId}`, "_blank", "noopener,noreferrer");
      }}
      data-join-call={canJoin ? "ready" : "disabled"}
    >
      <VideoIcon className="mr-1.5 size-3.5" />
      {label}
    </Button>
  );

  // When disabled with a "joinable" URL we still wrap in a Link so the
  // server route can render its own denial message (and so right-click
  // "open in new tab" still works in the rare case the boundary has
  // just flipped).
  return (
    <Link
      href={`/call/${bookingId}`}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      className={canJoin ? "contents" : "pointer-events-none"}
    >
      {button}
    </Link>
  );
}