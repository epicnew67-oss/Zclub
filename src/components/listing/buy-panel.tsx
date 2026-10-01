"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  BadgeCheckIcon,
  ClockIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { purchaseSlotAction } from "@/app/orders/actions";
import type { BrowseListingDetail } from "@/lib/browse";

function formatLocalRange(startsIso: string, endsIso: string): string {
  const s = new Date(startsIso);
  const e = new Date(endsIso);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${s.toLocaleString(undefined, opts)} – ${e.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function InsufficientBalanceToast({
  shortfall,
  returnUrl,
}: {
  shortfall: number;
  returnUrl: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        You need {shortfall.toLocaleString()} more tokens.
      </p>
      <p className="text-xs text-muted-foreground">
        Top up to reserve this slot — we&apos;ll bring you right back.
      </p>
      <Button asChild size="sm" className="mt-1 w-fit bg-burgundy hover:bg-burgundy/90">
        <Link
          href={`/wallet/topup?needed=${shortfall}&return=${encodeURIComponent(returnUrl)}`}
        >
          <WalletIcon data-icon="inline-start" /> Top up {shortfall.toLocaleString()} tokens
        </Link>
      </Button>
    </div>
  );
}

export function BuyPanel({
  listing,
  signedIn,
}: {
  listing: BrowseListingDetail;
  signedIn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const slotId = params.get("slot");
  const selectedSlot =
    listing.upcoming_slots.find((s) => s.id === slotId) ?? null;

  function signInHref() {
    const next = encodeURIComponent(
      pathname + (params.toString() ? `?${params.toString()}` : "")
    );
    return `/auth/sign-in?next=${next}`;
  }

  function currentReturnUrl() {
    return pathname + (params.toString() ? `?${params.toString()}` : "");
  }

  function handleReserve() {
    if (!selectedSlot) return;
    startTransition(async () => {
      const result = await purchaseSlotAction(selectedSlot.id);
      if (result.ok) {
        toast.success("Slot reserved — opening your order…");
        router.push(`/orders/${result.bookingId}`);
        return;
      }
      switch (result.code) {
        case "INSUFFICIENT_BALANCE":
          toast.error(
            <InsufficientBalanceToast
              shortfall={result.shortfall}
              returnUrl={currentReturnUrl()}
            />,
            { duration: 12000 }
          );
          break;
        case "slot_already_taken":
          toast.error("That slot was just taken — pick another time.");
          router.refresh();
          break;
        case "cannot_self_book":
          toast.error("You can't book your own listing.");
          break;
        case "listing_unavailable":
          toast.error("This listing is no longer available.");
          router.refresh();
          break;
        case "slot_not_open":
        case "slot_in_past":
        case "slot_not_found":
          toast.error("This slot is no longer bookable — pick another.");
          router.refresh();
          break;
        default:
          toast.error("Could not complete the purchase. Try again.");
      }
    });
  }

  return (
    <Card
      variant="gold"
      className="space-y-4 p-5 md:sticky md:top-20"
      data-buy-panel
    >
      <div>
        <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
          Price
        </p>
        <p className="mt-0.5 flex items-baseline gap-1">
          <span className="font-heading text-3xl font-semibold text-gold">
            {listing.price_tokens.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">tokens</span>
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2 text-foreground/90">
          <ClockIcon className="size-4 text-gold" />
          {listing.duration_minutes} min
        </li>
        <li className="flex items-center gap-2 text-foreground/90">
          <ShieldCheckIcon className="size-4 text-gold" />
          Tokens escrowed until call completes
        </li>
        <li className="flex items-center gap-2 text-foreground/90">
          <WalletIcon className="size-4 text-gold" />
          Refund if seller no-shows
        </li>
      </ul>

      {selectedSlot ? (
        <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs">
          <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
            Selected slot
          </p>
          <p className="mt-0.5 text-foreground/90">
            {formatLocalRange(selectedSlot.starts_at, selectedSlot.ends_at)}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {selectedSlot.price_tokens.toLocaleString()} tokens
          </p>
        </div>
      ) : null}

      {signedIn ? (
        <>
          <Button
            type="button"
            size="lg"
            className="w-full bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90"
            disabled={!selectedSlot || pending}
            onClick={handleReserve}
          >
            {pending
              ? "Reserving…"
              : selectedSlot
                ? "Reserve this slot"
                : "Pick a slot first"}
          </Button>
          {!selectedSlot ? (
            <p className="text-center text-xs text-muted-foreground">
              Choose an open slot above to reserve this call.
            </p>
          ) : null}
        </>
      ) : (
        <Button
          asChild
          size="lg"
          className="w-full bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90"
        >
          <a href={signInHref()}>Sign in to book</a>
        </Button>
      )}

      <div className="flex items-center gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-md border border-gold/30 bg-gold/10 font-heading text-[10px] text-gold">
          {listing.seller.display_name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate text-foreground/90">
            {listing.seller.display_name}
            {listing.seller.is_verified ? (
              <BadgeCheckIcon className="size-3.5 text-gold" aria-label="Verified" />
            ) : null}
          </p>
          {listing.seller.tagline ? (
            <p className="truncate">{listing.seller.tagline}</p>
          ) : null}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Booking locks the slot immediately. You can cancel for a full refund
        up to 24 hours before the call.
      </p>
    </Card>
  );
}
