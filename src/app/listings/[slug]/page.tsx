import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeCheckIcon, StarIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PhotoGallery } from "@/components/listing/photo-gallery";
import { SlotsPicker } from "@/components/listing/slots-picker";
import { BuyPanel } from "@/components/listing/buy-panel";
import { getListingBySlug } from "@/lib/browse";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isSupabaseConfigured()) return { title: "Listing" };
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Listing not found" };
  return {
    title: `${listing.title} — ${listing.seller.display_name}`,
    description:
      listing.description ??
      `${listing.seller.display_name} offers a ${listing.duration_minutes}-min call for ${listing.price_tokens} tokens.`,
  };
}

export default async function ListingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ slot?: string }>;
}) {
  const { slug } = await params;
  await searchParams; // keep await so URL changes re-render

  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to view this listing.
        </p>
      </div>
    );
  }

  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  // Server-side session (same source as the navbar) so the buy panel
  // never shows the signed-out CTA to a signed-in visitor.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 md:px-6 md:py-12">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/" className="hover:text-gold">Home</Link>
        <span className="mx-1.5">/</span>
        <Link href="/browse" className="hover:text-gold">Browse</Link>
        {listing.category ? (
          <>
            <span className="mx-1.5">/</span>
            <Link
              href={`/browse?category=${listing.category.slug}`}
              className="hover:text-gold"
            >
              {listing.category.name}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <main className="flex min-w-0 flex-col gap-8">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {listing.category ? (
                <Badge variant="outline" className="border-gold/40">
                  {listing.category.name}
                </Badge>
              ) : null}
              {listing.seller.is_verified ? (
                <Badge variant="success">Verified</Badge>
              ) : null}
            </div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">
              {listing.title}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="grid size-8 place-items-center rounded-md border border-gold/30 bg-gold/10 font-heading text-xs text-gold">
                {listing.seller.display_name.slice(0, 2).toUpperCase()}
              </span>
              <span className="font-medium text-foreground/90">
                {listing.seller.display_name}
              </span>
              {listing.seller.is_verified ? (
                <BadgeCheckIcon className="size-4 text-gold" aria-label="Verified" />
              ) : null}
              {listing.seller.tagline ? (
                <span className="hidden sm:inline">· {listing.seller.tagline}</span>
              ) : null}
            </div>
          </header>

          <PhotoGallery photos={listing.photos} />

          <Separator className="bg-gold/15" />

          <section className="space-y-3">
            <h2 className="font-heading text-xl text-foreground">About this call</h2>
            {listing.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {listing.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The seller hasn&apos;t added a description yet.
              </p>
            )}
          </section>

          <Card variant="glow" className="p-5">
            <CardContent className="space-y-2 px-0">
              <h2 className="font-heading text-lg text-foreground">At a glance</h2>
              <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <li className="rounded-lg border border-border/70 bg-surface/40 p-3">
                  <p className="text-[10px] tracking-wider uppercase text-muted-foreground">Duration</p>
                  <p className="mt-0.5 font-medium text-foreground">{listing.duration_minutes} min</p>
                </li>
                <li className="rounded-lg border border-border/70 bg-surface/40 p-3">
                  <p className="text-[10px] tracking-wider uppercase text-muted-foreground">Price</p>
                  <p className="mt-0.5 font-medium text-gold">{listing.price_tokens.toLocaleString()} tokens</p>
                </li>
                <li className="rounded-lg border border-border/70 bg-surface/40 p-3">
                  <p className="text-[10px] tracking-wider uppercase text-muted-foreground">Open slots</p>
                  <p className="mt-0.5 font-medium text-foreground">{listing.upcoming_slots.length}</p>
                </li>
                <li className="rounded-lg border border-border/70 bg-surface/40 p-3">
                  <p className="text-[10px] tracking-wider uppercase text-muted-foreground">Rating</p>
                  <p className="mt-0.5 flex items-center gap-1 font-medium text-foreground">
                    <StarIcon className="size-3.5 text-gold" /> New
                  </p>
                </li>
              </ul>
            </CardContent>
          </Card>

          <SlotsPicker slots={listing.upcoming_slots} />
        </main>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Suspense fallback={null}>
            <BuyPanel listing={listing} signedIn={signedIn} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}