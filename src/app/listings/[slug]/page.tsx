/* eslint-disable @next/next/no-img-element -- Signed private seller avatars are short-lived URLs. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeCheckIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PhotoGallery } from "@/components/listing/photo-gallery";
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
      `${listing.seller.display_name} offers an on-demand call for ${listing.price_tokens} tokens.`,
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;

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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-10 md:px-8 md:py-16">
      <nav aria-label="Breadcrumb" className="text-[10px] font-semibold tracking-[.12em] text-muted-foreground uppercase">
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

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="flex min-w-0 flex-col gap-8">
          <header className="space-y-5 border-b border-gold/25 pb-7">
            <p className="editorial-kicker">Private call / The collection</p>
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
            <h1 className="max-w-3xl font-heading text-5xl leading-[.95] font-normal tracking-tight md:text-7xl">
              {listing.title}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-gold/40 bg-gold/10 font-heading text-sm text-gold">
                {listing.seller.avatar_url ? <img src={listing.seller.avatar_url} alt="" className="size-full object-cover" /> : listing.seller.display_name.slice(0, 2).toUpperCase()}
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

          <section className="space-y-5 py-2">
            <p className="editorial-kicker">The details</p>
            <h2 className="font-heading text-3xl text-foreground">About this call</h2>
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

          <Card variant="gold" className="p-5">
            <CardContent className="space-y-2 px-0">
              <h2 className="font-heading text-2xl text-foreground">At a glance</h2>
              <ul className="grid grid-cols-2 gap-3 text-sm">
                <li className="border-t border-gold/25 py-3">
                  <p className="text-[10px] tracking-wider uppercase text-muted-foreground">Price</p>
                  <p className="mt-0.5 font-medium text-gold">{listing.price_tokens.toLocaleString()} tokens</p>
                </li>
                <li className="border-t border-gold/25 py-3">
                  <p className="text-[10px] tracking-wider uppercase text-muted-foreground">Seller</p>
                  <p className="mt-0.5 font-medium text-foreground">{listing.seller.presence === "available" ? "Available now" : listing.seller.presence === "in_call" ? "In a call" : listing.seller.presence === "booked" ? "Booked" : "Offline"}</p>
                </li>
              </ul>
            </CardContent>
          </Card>

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
