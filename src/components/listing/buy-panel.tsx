"use client";

/* eslint-disable @next/next/no-img-element -- Signed private seller avatars are short-lived URLs. */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheckIcon, ShieldCheckIcon, WalletIcon, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { purchaseListingNowAction } from "@/app/orders/actions";
import type { BrowseListingDetail } from "@/lib/browse";

export function BuyPanel({ listing, signedIn }: { listing: BrowseListingDetail; signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const status = listing.seller.presence;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [router]);

  function book() {
    startTransition(async () => {
      const result = await purchaseListingNowAction(listing.id);
      if (result.ok) {
        toast.success("Call booked. You can join now.");
        router.push(`/orders/${result.bookingId}`);
        return;
      }
      if (result.code === "INSUFFICIENT_BALANCE") {
        toast.error(`You need ${result.shortfall} more tokens.`, {
          action: { label: "Top up", onClick: () => router.push(`/wallet/topup?needed=${result.shortfall}&return=${encodeURIComponent(pathname)}`) },
        });
      } else if (result.code === "seller_busy") toast.warning("Seller is in a call. Please try again soon.");
      else if (result.code === "seller_offline") toast.info("Seller went offline. Please try again when they return.");
      else if (result.code === "cannot_self_book") toast.error("You can't book your own listing.");
      else toast.error("This call could not be booked. Please try again.");
      router.refresh();
    });
  }

  return (
    <Card variant="gold" className="space-y-5 p-5 md:sticky md:top-20" data-buy-panel>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Video call</p><p className="mt-1 font-heading text-3xl font-semibold text-gold">{listing.price_tokens.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">tokens</span></p></div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${status === "available" ? "border-success/40 bg-success/10 text-success" : status === "in_call" ? "border-warning/40 bg-warning/10 text-warning" : "border-border text-muted-foreground"}`}>
          {status === "available" ? "● Available now" : status === "in_call" ? "● In a call" : status === "booked" ? "● Booked" : "● Offline"}
        </span>
      </div>
      <ul className="space-y-2 text-sm text-foreground/90">
        <li className="flex items-center gap-2"><VideoIcon className="size-4 text-gold" /> Join after booking</li>
        <li className="flex items-center gap-2"><ShieldCheckIcon className="size-4 text-gold" /> Tokens held until call completes</li>
        <li className="flex items-center gap-2"><WalletIcon className="size-4 text-gold" /> Full refund if cancelled before anyone joins</li>
      </ul>
      {signedIn ? <Button type="button" size="lg" className="w-full bg-burgundy text-foreground" disabled={pending || status !== "available"} onClick={book}>{pending ? "Booking…" : status === "available" ? "Book and join now" : status === "in_call" ? "Seller is in a call" : status === "booked" ? "Seller has a booking" : "Seller is offline"}</Button>
        : <Button asChild size="lg" className="w-full bg-burgundy text-foreground"><Link href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`}>Sign in to book</Link></Button>}
      <div className="flex items-center gap-3 border-t border-border/70 pt-4">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-gold/40 bg-gold/10 font-heading text-sm text-gold">
          {listing.seller.avatar_url ? <img src={listing.seller.avatar_url} alt="" className="size-full object-cover" /> : listing.seller.display_name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0"><p className="flex items-center gap-1 truncate font-medium">{listing.seller.display_name}{listing.seller.is_verified ? <BadgeCheckIcon className="size-4 text-gold" aria-label="Verified" /> : null}</p>{listing.seller.tagline ? <p className="truncate text-xs text-muted-foreground">{listing.seller.tagline}</p> : null}</div>
      </div>
    </Card>
  );
}
