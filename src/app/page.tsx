import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRightIcon, SearchIcon, VideoIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ListingCard } from "@/components/browse/listing-card";
import { PresenceRefresh } from "@/components/browse/presence-refresh";
import { HomeFaq } from "@/components/home/home-faq";
import { CinematicHero } from "@/components/home/cinematic-hero";
import { listBrowseListings } from "@/lib/browse";
import { brand } from "@/lib/brand";

export const metadata: Metadata = { title: `${brand.name} | Private video calls`, description: brand.description };

export default async function Home() {
  const { rows } = isSupabaseConfigured() ? await listBrowseListings({ sort: "newest", limit: 40 }) : { rows: [] };
  const rank = { available: 0, booked: 1, in_call: 2, offline: 3 };
  const listings = [...rows].sort((a, b) => rank[a.seller.presence] - rank[b.seller.presence]).slice(0, 8);
  return <>
    <PresenceRefresh />
    <CinematicHero />
    <section id="meet" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto max-w-[1440px] px-5 py-14 md:px-10 md:py-20 lg:px-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div><p className="editorial-kicker">The people. The possibilities.</p><h2 className="mt-3 font-heading text-4xl tracking-[-.035em] md:text-6xl">Who caught <em className="text-gold-soft">your eye?</em></h2></div>
          <Link href="/browse" className="inline-flex items-center gap-3 border-b border-gold/50 pb-2 text-sm text-gold-soft hover:text-foreground">Meet all sellers <ArrowUpRightIcon className="size-4" /></Link>
        </div>
        <form action="/browse" className="mb-8 flex max-w-xl items-center gap-3 border-b border-border pb-3">
          <SearchIcon className="size-5 text-muted-foreground" aria-hidden />
          <input name="q" type="search" aria-label="Search sellers and calls" placeholder="Find a seller or a call" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground" />
          <button type="submit" aria-label="Search" className="p-2 text-gold-soft"><ArrowUpRightIcon className="size-5" /></button>
        </form>
        {listings.length ? <div data-browse-grid className="grid grid-cols-2 gap-x-3 gap-y-8 md:gap-x-5 lg:grid-cols-4">{listings.map(listing => <ListingCard key={listing.id} listing={listing} />)}</div> : <div className="flex min-h-52 flex-col items-center justify-center border border-border px-5 text-center"><VideoIcon className="mb-4 size-7 text-gold" /><h3 className="font-heading text-3xl">The next connection is coming.</h3><p className="mt-3 text-sm text-muted-foreground">New sellers and calls will appear here.</p></div>}
      </div>
    </section>
    <section id="how-it-works" className="scroll-mt-24 border-y border-border bg-card">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-12 md:grid-cols-[.9fr_2fr] md:px-10 lg:px-16">
        <div><p className="editorial-kicker">Make it happen</p><h2 className="mt-3 font-heading text-4xl leading-tight">From a glance<br />to a <em className="text-gold-soft">hello.</em></h2></div>
        <ol className="grid gap-7 sm:grid-cols-3">
          {[['01','Find your person','Open a profile. See the photos, the details, and whether they are online.'],['02','Choose your call','Pick a service and pay the clear price with tokens.'],['03','Meet one to one','Join your private video call from your order.']].map(([number,title,body]) => <li key={number} className="border-t border-gold/30 pt-4"><span className="text-xs text-gold">{number}</span><h3 className="mt-5 text-base font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p></li>)}
        </ol>
      </div>
    </section>
    <section className="relative isolate overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-full opacity-40 md:w-1/2 md:opacity-80"><Image src="/editorial/editorial-shadow.webp" alt="" fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover object-center" /></div>
      <div className="absolute inset-0 bg-gradient-to-l from-background via-background/80 to-transparent" />
      <div className="relative mx-auto flex min-h-[32rem] max-w-[1440px] items-center justify-end px-5 py-16 md:px-10 lg:px-16"><div className="max-w-xl md:w-1/2"><p className="editorial-kicker">Your profile. Your presence.</p><h2 className="mt-5 font-heading text-5xl leading-[.98] tracking-tight md:text-7xl">Be the reason<br />they <em className="text-gold-soft">stay.</em></h2><p className="mt-6 max-w-sm text-sm leading-7 text-foreground/75">Create a profile that feels like you. List your calls and choose when you are available.</p><Link href="/become-a-seller" className="mt-8 inline-flex min-h-12 items-center gap-5 border border-gold/50 px-6 text-sm text-gold-soft hover:bg-gold/10">Become a seller <ArrowUpRightIcon className="size-4" /></Link></div></div>
    </section>
    <HomeFaq />
  </>;
}
