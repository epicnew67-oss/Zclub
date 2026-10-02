import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { ListingCard } from "@/components/browse/listing-card";
import { BrowseToolbar } from "@/components/browse/browse-toolbar";
import { BrowseSkeletonGrid } from "@/components/browse/browse-skeleton";
import { getCategories, listBrowseListings, type BrowseSort } from "@/lib/browse";

export const metadata: Metadata = {
  title: "Browse",
  description:
    "Discover sellers offering 1:1 video calls. Filter by category, sort by price or duration.",
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-6 md:py-12">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">
          <span className="text-gold">Browse calls</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find a seller, compare calls, and reserve an available time with tokens.
        </p>
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
