/* eslint-disable @next/next/no-img-element -- Private profile photos use signed URLs. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ArrowDownIcon, BadgeCheckIcon, UserRoundIcon } from "lucide-react";
import { getPublicSellerProfile } from "@/lib/browse";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ListingCard } from "@/components/browse/listing-card";
import { PresenceRefresh } from "@/components/browse/presence-refresh";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isSupabaseConfigured()) return { title: "Seller" };
  const profile = await getPublicSellerProfile((await params).slug);
  return { title: profile?.seller.display_name ?? "Seller not found", description: profile?.seller.tagline ?? "Meet your next private call host." };
}

export default async function PublicSellerPage({ params }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const profile = await getPublicSellerProfile((await params).slug);
  if (!profile) notFound();
  const { seller, listings } = profile;
  const photo = seller.avatar_url || listings.find(listing => listing.cover)?.cover;
  const status = { available: "Online now", booked: "Booked", in_call: "In a call", offline: "Offline" }[seller.presence];
  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
    <PresenceRefresh />
    <Link href="/browse" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /> All sellers</Link>
    <section className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
      <div className="relative aspect-[4/5] max-h-[680px] overflow-hidden bg-card">
        {photo ? <img src={photo} alt={seller.display_name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted-foreground"><UserRoundIcon className="size-24" strokeWidth={.7} /></div>}
        <span className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full border border-white/20 bg-black/65 px-4 py-2 text-xs text-white backdrop-blur"><span className={`size-2 rounded-full ${seller.presence === "available" ? "bg-success" : "bg-white/60"}`} />{status}</span>
      </div>
      <div className="py-3">
        <p className="editorial-kicker">A little introduction</p>
        <h1 className="mt-5 break-words font-heading text-5xl leading-tight tracking-tight md:text-7xl">{seller.display_name}{seller.is_verified ? <BadgeCheckIcon className="ml-3 inline size-7 text-gold" aria-label="Verified seller" /> : null}</h1>
        {seller.tagline ? <p className="mt-5 text-xl leading-relaxed text-gold-soft">{seller.tagline}</p> : null}
        <p className="mt-7 max-w-lg whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{seller.bio || "Get to know each other in a private video call. Browse the available services below."}</p>
        <a href="#services" className="mt-9 inline-flex min-h-12 items-center gap-8 bg-foreground px-6 text-sm font-semibold text-background hover:bg-gold-soft">Explore my calls <ArrowDownIcon className="size-4" /></a>
        <p className="mt-5 text-xs text-muted-foreground">{seller.presence === "available" ? "Available for a call now." : seller.presence === "offline" ? "Come back when this seller is online to book." : "This seller is with another customer. Check back soon."}</p>
      </div>
    </section>
    <section id="services" className="scroll-mt-24 border-t border-border mt-16 pt-10 pb-10">
      <p className="editorial-kicker">Just the two of you</p>
      <h2 className="mt-3 mb-8 font-heading text-4xl">Choose your call.</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">{listings.map(listing => <ListingCard key={listing.id} listing={listing} />)}</div>
    </section>
  </div>;
}
