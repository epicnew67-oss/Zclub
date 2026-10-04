import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { ListingCard } from "@/components/browse/listing-card";
import { BrowseToolbar } from "@/components/browse/browse-toolbar";
import { BrowseSkeletonGrid } from "@/components/browse/browse-skeleton";
import { PresenceRefresh } from "@/components/browse/presence-refresh";
import { listBrowseListings, type BrowseSort } from "@/lib/browse";

export const metadata: Metadata = {
  title: "Browse",
  description:
    "Discover sellers offering on-demand 1:1 video calls. View profiles, see who is online, and choose your call.",
};

const VALID_SORTS: BrowseSort[] = [
  "newest",
  "price_asc",
  "price_desc",
  "duration_asc",
  "duration_desc",
];

function parseSort(value: string | undefined): BrowseSort {
  return VALID_SORTS.includes(value as BrowseSort)
    ? (value as BrowseSort)
    : "newest";
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const initialSearch = (params.q ?? "").trim();
  const initialCategory = (params.category ?? "").trim();
  const initialSort = parseSort(params.sort);

  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to browse listings.
        </p>
      </div>
    );
  }

  const { rows, total } = await listBrowseListings({
      search: initialSearch || undefined,
      categorySlug: initialCategory || undefined,
      sort: initialSort,
      limit: 24,
    });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-10 md:px-8 md:py-16">
      <PresenceRefresh />
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-9">
        <div><p className="editorial-kicker">A face. A spark. A conversation.</p><h1 className="mt-5 font-heading text-5xl leading-none tracking-tight md:text-7xl">Someone worth<br /><em className="text-gold-soft">staying for.</em></h1></div>
        <p className="max-w-xs text-sm leading-7 text-muted-foreground">Find a seller who catches your eye. Open their profile and make your next connection a private one.</p>
      </header>

      <BrowseToolbar
        initialSearch={initialSearch}
        initialSort={initialSort}
        resultCount={total}
      />

      <Suspense
        key={`${initialSearch}|${initialCategory}|${initialSort}`}
        fallback={<BrowseSkeletonGrid />}
      >
        {rows.length === 0 ? (
          <div className="rounded-xl border border-gold/20 bg-surface/40 px-6 py-16 text-center">
            <p className="font-heading text-lg text-foreground">
              No listings found
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different search or check back when sellers publish more calls.
            </p>
            <Link href="/become-a-seller" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-gold hover:underline">Become a seller <ArrowRightIcon className="size-4" /></Link>
          </div>
        ) : (
          <div
            data-browse-grid
            className="grid grid-cols-2 gap-x-3 gap-y-9 md:gap-x-5 lg:grid-cols-3 xl:grid-cols-4"
          >
            {rows.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </Suspense>
    </div>
  );
}
