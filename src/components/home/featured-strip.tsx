import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { ListingCard } from "@/components/browse/listing-card";
import { RevealSection } from "@/components/home/reveal-section";
import type { BrowseListing } from "@/lib/browse";

export function FeaturedStrip({ listings }: { listings: BrowseListing[] }) {
  if (listings.length === 0) return null;
  return (
    <RevealSection
      target="[data-reveal], [data-browse-card]"
      className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14"
    >
      <div
        data-reveal
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            <span className="text-gold">Featured</span> sellers
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hand-picked creators, recently approved.
          </p>
        </div>
        <Link
          href="/browse"
          className="inline-flex items-center gap-1 text-sm font-medium text-gold hover:underline"
        >
          See all
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>
      <div
        className="-mx-4 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0 md:pb-0"
        data-browse-grid
      >
        {listings.slice(0, 4).map((listing) => (
          <div
            key={listing.id}
            className="w-72 shrink-0 snap-start md:w-auto md:shrink"
          >
            <ListingCard listing={listing} />
          </div>
        ))}
      </div>
    </RevealSection>
  );
}