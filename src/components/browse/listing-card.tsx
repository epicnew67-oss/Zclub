/* eslint-disable @next/next/no-img-element -- Signed seller images use short-lived URLs. */
import Link from "next/link";
import { ArrowUpRightIcon, BadgeCheckIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/brand/Logo";
import { ListingLinkFeedback } from "@/components/browse/listing-link-feedback";
import { cn } from "cn";
import type { BrowseListing } from "@/lib/browse";

export function ListingCard({ listing, className }: { listing: BrowseListing; className?: string }) {
  const presence = listing.seller.presence;
  const status = presence === "available" ? "Available now" : presence === "in_call" ? "In a call" : presence === "booked" ? "Booked" : "Offline";

  return (
    <Card data-browse-card className={cn("group/card relative gap-0 overflow-hidden rounded-sm border-gold/25 py-0 transition-colors hover:border-gold/70", className)}>
      <Link href={`/listings/${listing.slug}`} aria-label={`View ${listing.title} by ${listing.seller.display_name}`} className="flex h-full flex-col">
        <ListingLinkFeedback />
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-elevated">
          {listing.cover ? (
            <img src={listing.cover} alt="" loading="lazy" decoding="async" className="editorial-image h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(140deg,#281d18,#100d0b)]"><Logo variant="mark" size="xl" className="opacity-65" /></div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background/80 to-transparent" />
          <div className="absolute top-3 left-3 flex items-center gap-2 border border-foreground/20 bg-background/85 px-2.5 py-1.5 text-[10px] font-semibold tracking-[.1em] text-foreground uppercase backdrop-blur">
            <span className={cn("size-1.5 rounded-full", presence === "available" ? "bg-success" : presence === "in_call" ? "bg-gold" : "bg-muted-foreground")} aria-hidden="true" />
            {status}
          </div>
          {listing.category ? <span className="absolute right-3 bottom-3 max-w-[80%] truncate border border-gold/40 bg-background/85 px-2.5 py-1.5 text-[10px] font-semibold tracking-[.1em] text-gold-soft uppercase backdrop-blur">{listing.category.name}</span> : null}
        </div>
        <div className="flex flex-1 flex-col gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {listing.seller.avatar_url ? <img src={listing.seller.avatar_url} alt="" className="size-6 shrink-0 rounded-full object-cover" /> : <span className="size-6 shrink-0 rounded-full border border-gold/30 bg-elevated" />}
            <span className="truncate tracking-[.04em]">{listing.seller.display_name}</span>
            {listing.seller.is_verified ? <BadgeCheckIcon aria-label="Verified" className="size-3.5 shrink-0 text-gold" /> : null}
          </div>
          <h3 className="line-clamp-2 min-h-[3.3rem] font-heading text-xl leading-tight text-foreground">{listing.title}</h3>
          <div className="mt-auto flex items-end justify-between gap-2 border-t border-gold/20 pt-4">
            <div><span className="font-heading text-2xl leading-none text-gold-soft">{listing.price_tokens.toLocaleString()}</span><span className="ml-1 text-[10px] font-semibold tracking-[.1em] text-muted-foreground uppercase">tokens</span></div>
            <ArrowUpRightIcon className="size-5 text-gold transition-transform group-hover/card:-translate-y-1 group-hover/card:translate-x-1" aria-hidden="true" />
          </div>
        </div>
      </Link>
    </Card>
  );
}
