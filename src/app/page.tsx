import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDownRightIcon, ArrowRightIcon, SearchIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ListingCard } from "@/components/browse/listing-card";
import { PresenceRefresh } from "@/components/browse/presence-refresh";
import { CategoryGrid } from "@/components/home/category-grid";
import { HowItWorks } from "@/components/home/how-it-works";
import { HomeFaq } from "@/components/home/home-faq";
import { EditorialHeroMotion } from "@/components/home/editorial-hero-motion";
import { getCategories, listBrowseListings } from "@/lib/browse";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${brand.name} | Private 1:1 video calls`,
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
      <section data-editorial-hero className="relative isolate overflow-hidden border-b border-gold/25">
        <EditorialHeroMotion />
        <div className="mx-auto grid min-h-[42rem] max-w-7xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]">
          <div className="relative z-10 flex flex-col justify-between px-5 py-12 md:px-8 md:py-16 lg:py-20">
            <div data-hero-reveal>
              <p className="editorial-kicker flex items-center gap-3"><span className="h-px w-8 bg-gold" /> The private room / 001</p>
              <h1 className="mt-10 max-w-[12ch] font-heading text-[clamp(4rem,8vw,8rem)] leading-[.83] font-normal tracking-[-.055em] text-foreground">
                A room<br />for <em className="font-normal text-gold-soft">just two.</em>
              </h1>
              <p className="mt-9 max-w-lg border-l border-gold/60 pl-5 text-base leading-relaxed text-foreground/75 md:text-lg">
                Private 1:1 video calls. Find someone online, book with tokens, and join your call when it starts.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/browse" className="inline-flex min-h-12 items-center justify-center gap-4 rounded-sm border border-gold bg-gold px-6 text-xs font-bold tracking-[.14em] text-background uppercase transition-colors hover:bg-gold-soft">
                  Explore calls <ArrowRightIcon className="size-4" />
                </Link>
                <Link href="/#how-it-works" className="inline-flex min-h-12 items-center justify-center gap-4 rounded-sm border border-gold/50 px-6 text-xs font-bold tracking-[.14em] text-gold-soft uppercase transition-colors hover:border-gold hover:bg-gold/10">
                  How it works <ArrowDownRightIcon className="size-4" />
                </Link>
              </div>
            </div>
            <div data-hero-reveal className="mt-16 grid max-w-lg grid-cols-3 gap-4 border-t border-gold/25 pt-5 text-[10px] font-semibold tracking-[.15em] text-muted-foreground uppercase">
              <span>01 / Discover</span><span>02 / Book</span><span>03 / Connect</span>
            </div>
          </div>

          <div data-hero-image className="relative min-h-[31rem] overflow-hidden border-t border-gold/20 bg-elevated lg:min-h-[42rem] lg:border-t-0 lg:border-l">
            <div className="absolute inset-0 grid grid-cols-[55%_45%] grid-rows-2 gap-[3px] bg-background">
              <div className="relative row-span-2 overflow-hidden">
                <Image data-cinematic-frame src="/editorial/editorial-portrait.webp" alt="" fill priority sizes="(max-width: 1024px) 55vw, 30vw" className="editorial-image object-cover object-[50%_35%]" />
              </div>
              <div className="relative overflow-hidden">
                <Image data-cinematic-frame src="/editorial/editorial-shadow.webp" alt="" fill priority sizes="(max-width: 1024px) 45vw, 22vw" className="editorial-image object-cover object-center" />
              </div>
              <div className="relative overflow-hidden">
                <Image data-cinematic-frame src="/editorial/editorial-wide.webp" alt="" fill sizes="(max-width: 1024px) 45vw, 22vw" className="editorial-image object-cover object-[45%_center]" />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background/90 to-transparent" />
            <div className="absolute right-5 bottom-5 left-5 flex items-end justify-between gap-3 border-t border-gold/50 pt-4 text-[10px] font-semibold tracking-[.18em] text-foreground uppercase md:right-8 md:bottom-8 md:left-8">
              <span>Private by design</span><span>StripClub / Online</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-gold/15 bg-surface/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-7 md:flex-row md:items-center md:justify-between md:px-8">
          <div><p className="editorial-kicker">Find your next call</p><p className="mt-1 font-heading text-2xl leading-tight text-foreground">Someone worth meeting is one search away.</p></div>
          <form action="/browse" className="flex w-full max-w-xl items-center gap-2 border-b border-gold/60 pb-2">
            <SearchIcon aria-hidden className="size-5 shrink-0 text-gold" />
            <input name="q" type="search" aria-label="Search calls" placeholder="Search sellers and calls" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            <button type="submit" className="p-2 text-gold transition-colors hover:text-gold-soft" aria-label="Search"><ArrowRightIcon className="size-5" /></button>
          </form>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-16 md:px-8 md:py-24">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5 border-b border-gold/25 pb-6">
          <div><p className="editorial-kicker">01 / The collection</p><h2 className="mt-3 font-heading text-4xl leading-none font-normal md:text-6xl">Discover <em className="text-gold-soft">private calls.</em></h2></div>
          <Link href="/browse" className="inline-flex items-center gap-2 text-xs font-bold tracking-[.14em] text-gold uppercase hover:text-gold-soft">View all calls <ArrowRightIcon className="size-4" /></Link>
        </div>
        {listings.length ? (
          <div data-browse-grid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div>
        ) : (
          <div className="grid min-h-60 place-items-center border border-gold/25 bg-surface/60 px-6 py-12 text-center">
            <div><p className="editorial-kicker">The collection is growing</p><h3 className="mt-3 font-heading text-3xl">New calls are coming.</h3><Link href="/become-a-seller" className="mt-5 inline-flex items-center gap-2 text-sm text-gold hover:text-gold-soft">Become a seller <ArrowRightIcon className="size-4" /></Link></div>
          </div>
        )}
      </section>

      <CategoryGrid categories={categories} />
      <HowItWorks />

      <section className="mx-auto grid max-w-7xl gap-0 px-5 py-16 md:grid-cols-2 md:px-8 md:py-24">
        <div className="relative min-h-80 overflow-hidden bg-elevated md:min-h-[32rem]">
          <Image src="/editorial/brand-art.webp" alt="" fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
        </div>
        <div className="flex flex-col justify-center border border-gold/30 bg-burgundy-deep px-8 py-12 md:px-14">
          <p className="editorial-kicker">For sellers / 004</p>
          <h2 className="mt-6 font-heading text-5xl leading-[.95] md:text-7xl">Your time.<br /><em className="text-gold-soft">Your stage.</em></h2>
          <p className="mt-7 max-w-sm text-sm leading-7 text-foreground/75">Create your profile, list what you offer, and take private calls when you choose to be online.</p>
          <Link href="/become-a-seller" className="mt-9 inline-flex w-fit items-center gap-3 border-b border-gold pb-2 text-xs font-bold tracking-[.16em] text-gold uppercase hover:text-gold-soft">Start selling <ArrowRightIcon className="size-4" /></Link>
        </div>
      </section>

      <HomeFaq />
    </>
  );
}
