import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, SearchIcon, VideoIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ListingCard } from "@/components/browse/listing-card";
import { PresenceRefresh } from "@/components/browse/presence-refresh";
import { CategoryGrid } from "@/components/home/category-grid";
import { HowItWorks } from "@/components/home/how-it-works";
import { HomeFaq } from "@/components/home/home-faq";
import { getCategories, listBrowseListings } from "@/lib/browse";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${brand.name} ? Book private video calls`,
  description: brand.description,
};

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-sm text-muted-foreground">The marketplace is being configured.</div>;
  }

  const [categories, { rows: listings }] = await Promise.all([
    getCategories(),
    listBrowseListings({ sort: "newest", limit: 8 }),
  ]);

  return (
    <>
      <PresenceRefresh />
      <section className="border-b border-gold/15 bg-[radial-gradient(ellipse_at_top_left,rgba(102,14,18,0.38),transparent_58%)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center md:px-6 md:py-20">
          <div className="max-w-2xl space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-3 py-1 text-xs font-medium text-gold"><VideoIcon className="size-3.5" /> Private 1:1 video calls</p>
            <h1 className="font-heading text-4xl font-semibold leading-tight tracking-tight md:text-6xl">Find a creator. <span className="text-gold">Book a private call.</span></h1>
            <p className="max-w-xl text-base leading-relaxed text-foreground/75">Browse verified sellers, choose an available time, and pay with tokens. Your booking and video call stay in one place.</p>
            <form action="/browse" className="flex max-w-xl items-center gap-2 rounded-xl border border-gold/30 bg-background/80 p-2 shadow-soft">
              <SearchIcon aria-hidden className="ml-2 size-5 shrink-0 text-gold" />
              <input name="q" type="search" aria-label="Search calls" placeholder="Search calls" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
              <button type="submit" className="rounded-lg bg-burgundy px-4 py-2 text-sm font-semibold text-white hover:bg-burgundy/90">Search</button>
            </form>
          </div>
          <div className="grid gap-3 rounded-2xl border border-gold/20 bg-background/70 p-5 shadow-soft">
            <p className="font-heading text-xl text-foreground">Get started</p>
            <Link href="/browse" className="flex items-center justify-between rounded-xl border border-gold/20 px-4 py-3 text-sm hover:border-gold/50 hover:bg-gold/5">Browse calls <ArrowRightIcon className="size-4 text-gold" /></Link>
            <Link href="/wallet/topup" className="flex items-center justify-between rounded-xl border border-gold/20 px-4 py-3 text-sm hover:border-gold/50 hover:bg-gold/5">Buy tokens <ArrowRightIcon className="size-4 text-gold" /></Link>
            <Link href="/become-a-seller" className="flex items-center justify-between rounded-xl border border-gold/20 px-4 py-3 text-sm hover:border-gold/50 hover:bg-gold/5">Start selling <ArrowRightIcon className="size-4 text-gold" /></Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-heading text-2xl font-semibold md:text-3xl">Explore <span className="text-gold">calls</span></h2><p className="mt-1 text-sm text-muted-foreground">Real listings from approved sellers.</p></div>
          <Link href="/browse" className="inline-flex items-center gap-1 text-sm font-medium text-gold hover:underline">See all <ArrowRightIcon className="size-4" /></Link>
        </div>
        {listings.length ? <div data-browse-grid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div> : <div className="rounded-2xl border border-gold/20 bg-surface/40 px-6 py-12 text-center"><h3 className="font-heading text-xl">New calls are coming</h3><p className="mt-2 text-sm text-muted-foreground">Sellers have not published bookable listings yet.</p><Link href="/become-a-seller" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-gold hover:underline">Become a seller <ArrowRightIcon className="size-4" /></Link></div>}
      </section>

      <CategoryGrid categories={categories} />
      <HowItWorks />
      <HomeFaq />
    </>
  );
}
