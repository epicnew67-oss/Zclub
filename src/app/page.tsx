import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { HeroSection, type HeroStat } from "@/components/home/hero-section";
import { EditorialCategories } from "@/components/home/editorial-categories";
import { FeaturedStrip } from "@/components/home/featured-strip";
import { CategoryGrid } from "@/components/home/category-grid";
import { HowItWorks } from "@/components/home/how-it-works";
import { HomeFaq } from "@/components/home/home-faq";
import { brand } from "@/lib/brand";
import {
  getCategories,
  getFeaturedListings,
  getHomeStats,
  getSwarmImages,
} from "@/lib/browse";

export const metadata: Metadata = {
  title: `${brand.name} — Exclusive 1:1 video moments, booked in tokens.`,
  description: brand.description,
};

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to view the homepage.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    featured,
    categories,
    stats,
    swarmImages,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getFeaturedListings(4),
    getCategories(),
    getHomeStats(),
    getSwarmImages(12),
  ]);

  // Real counts from the DB; every value is already normalized to a
  // non-negative integer (0 on empty/error), so a fresh database renders
  // "0" — never NaN.
  const heroStats: HeroStat[] = [
    { label: "Verified sellers", value: stats.verifiedSellers },
    { label: "Live categories", value: stats.liveCategories },
    { label: "Tokens in escrow", value: stats.tokensInEscrow },
  ];

  return (
    <>
      <HeroSection
        headline={
          <>
            Exclusive 1:1 video moments,{" "}
            <span className="text-gold">booked in tokens.</span>
          </>
        }
        tagline="A curated marketplace of vetted creators — reserve a fixed-price slot, connect in the call, and pay only when it completes."
        stats={heroStats}
        signedIn={Boolean(user)}
        swarmImages={swarmImages}
      />
      <EditorialCategories categories={categories} />
      <FeaturedStrip listings={featured} />
      <CategoryGrid categories={categories} />
      <HowItWorks />
      <HomeFaq />
    </>
  );
}
