/* eslint-disable @next/next/no-img-element -- Seller images have short-lived signed URLs. */
import Link from "next/link";
import { ArrowUpRightIcon, BadgeCheckIcon, UserRoundIcon, VideoIcon } from "lucide-react";
import { ListingLinkFeedback } from "@/components/browse/listing-link-feedback";
import { cn } from "cn";
import type { BrowseListing } from "@/lib/browse";

export function ListingCard({ listing, className }: { listing: BrowseListing; className?: string }) {
  const presence = listing.seller.presence;
  const status = presence === "available" ? "Online now" : presence === "in_call" ? "In a call" : presence === "booked" ? "Booked" : "Offline";
  const photo = listing.cover || listing.seller.avatar_url;
  return <article data-browse-card className={cn("group/card min-w-0", className)}>
    <Link href={`/listings/${listing.slug}`} aria-label={`View ${listing.title} by ${listing.seller.display_name}`} className="relative block aspect-[3/4] overflow-hidden bg-card">
      <ListingLinkFeedback />
      {photo ? <img src={photo} alt={`${listing.seller.display_name}'s call preview`} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover/card:scale-[1.04]" /> : <div className="flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_top,var(--accent),var(--background))]"><UserRoundIcon className="size-12 text-gold/50 md:size-16" strokeWidth={.8} /><span className="text-[10px] tracking-[.15em] text-muted-foreground uppercase">Photo not added</span></div>}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/10" />
      <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1.5 text-[10px] font-medium text-white backdrop-blur-sm"><span aria-hidden className={cn("size-1.5 rounded-full", presence === "available" ? "bg-success" : presence === "in_call" ? "bg-gold" : "bg-white/50")} />{status}</span>
      <div className="absolute right-3 bottom-4 left-3 flex items-end justify-between gap-2 md:right-4 md:left-4">
        <div className="min-w-0"><p className="line-clamp-2 text-xs leading-5 text-white/90 md:text-sm">{listing.title}</p><p className="mt-2 text-sm font-semibold text-white md:text-base">{listing.price_tokens.toLocaleString()} <span className="text-[10px] font-normal text-white/65 md:text-xs">tokens</span></p></div>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full border border-white/30 md:size-10", presence === "available" ? "bg-white text-black" : "bg-black/25 text-white")}><VideoIcon aria-hidden className="size-4" /></span>
      </div>
    </Link>
    <div className="flex items-start justify-between gap-2 pt-3">
      <div className="min-w-0"><Link href={`/sellers/${listing.seller.slug}`} className="inline-flex max-w-full items-center gap-1.5 font-heading text-xl leading-tight text-foreground hover:text-gold-soft md:text-2xl"><span className="truncate">{listing.seller.display_name}</span>{listing.seller.is_verified ? <BadgeCheckIcon className="size-4 shrink-0 text-gold" aria-label="Verified" /> : null}</Link><p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">{listing.seller.tagline || "Private calls, on their terms."}</p></div>
      <Link href={`/sellers/${listing.seller.slug}`} aria-label={`View ${listing.seller.display_name}'s profile`} className="mt-1 p-1 text-muted-foreground hover:text-gold-soft"><ArrowUpRightIcon className="size-4" /></Link>
    </div>
  </article>;
}
