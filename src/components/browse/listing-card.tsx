import Link from "next/link";
import { BadgeCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "cn";
import type { BrowseListing } from "@/lib/browse";

export function ListingCard({
  listing,
  className,
}: {
  listing: BrowseListing;
  className?: string;
}) {
  return (
    <Card
      variant="gold"
      data-browse-card
      className={cn(
        "group/card relative flex h-full flex-col overflow-hidden transition-all duration-300",
        "hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-gold",
        className
      )}
    >
      <Link
        href={`/listings/${listing.slug}`}
        aria-label={`View ${listing.title} by ${listing.seller.display_name}`}
        className="flex h-full flex-col"
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-gold/15 bg-elevated">
          {listing.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.cover}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/card:scale-[1.03]"
            />
          ) : (
            // No photo available — show an abstract brand-gradient
            // tile instead of a "SC" placeholder so the card never
            // reads as empty / unfinished on the public homepage.
            <div className="relative h-full w-full bg-[linear-gradient(160deg,#1a0a0c_0%,#660e12_55%,#0a0506_100%)]">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(194,161,123,0.22),transparent_55%)]" />
            </div>
          )}
          {listing.category ? (
            <Badge
              variant="outline"
              className="absolute right-3 top-3 border-gold/40 bg-background/85 text-foreground/90 backdrop-blur"
            >
              {listing.category.name}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground/80">
              {listing.seller.display_name}
            </span>
            {listing.seller.is_verified ? (
              <BadgeCheckIcon
                aria-label="Verified"
                className="size-3.5 shrink-0 text-gold"
              />
            ) : null}
          </div>
          <p className="line-clamp-2 font-heading text-base font-medium text-foreground">
            {listing.title}
          </p>
          <div className="mt-auto flex items-center justify-between pt-2">
            <div className="flex items-baseline gap-1">
              <span className="font-heading text-lg font-semibold text-gold">
                {listing.price_tokens.toLocaleString()}
              </span>
              <span className="text-[10px] tracking-wider uppercase text-muted-foreground">
                tokens
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {listing.duration_minutes} min
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}