import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRightIcon } from "lucide-react";
import { ListingCard } from "@/components/browse/listing-card";
import { BrowseToolbar } from "@/components/browse/browse-toolbar";
import { BrowseSkeletonGrid } from "@/components/browse/browse-skeleton";
import { PresenceRefresh } from "@/components/browse/presence-refresh";
import { getCategories, listBrowseListings, type BrowseSort } from "@/lib/browse";

export const metadata: Metadata = {
  title: "Browse",
  description:
    "Discover sellers offering on-demand 1:1 video calls. Filter by category and sort by price.",
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

  const [categories, { rows, total }] = await Promise.all([
    getCategories(),
    listBrowseListings({
      search: initialSearch || undefined,
      categorySlug: initialCategory || undefined,
      sort: initialSort,
      limit: 24,
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-10 md:px-8 md:py-16">
      <PresenceRefresh />
      <header className="relative flex min-h-64 items-end overflow-hidden border border-gold/25 bg-elevated px-6 py-8 md:min-h-72 md:px-10 md:py-10">
        <Image src="/editorial/editorial-shadow.webp" alt="" fill priority sizes="(max-width: 768px) 100vw, 1200px" className="object-cover object-[50%_40%] opacity-45" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
        <div className="relative z-10 max-w-2xl">
          <p className="editorial-kicker">The collection / All calls</p>
          <h1 className="mt-4 font-heading text-5xl leading-none font-normal tracking-tight md:text-7xl">Find your <em className="text-gold-soft">moment.</em></h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-foreground/75">Browse real listings, see who is online, and book a private call with tokens.</p>
        </div>
      </header>

      <BrowseToolbar
        initialSearch={initialSearch}
        initialCategorySlug={initialCategory}
        initialSort={initialSort}
        categories={categories}
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
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
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
