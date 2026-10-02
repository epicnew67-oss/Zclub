import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/listings";
import { ListingForm } from "@/components/seller/listing-form";

export const metadata: Metadata = { title: "New listing · Seller" };

export default async function NewListingPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to create a listing.
        </p>
      </div>
    );
  }

  const { user } = await requireUser("/seller/listings/new");
  const supabase = await createClient();
  // RLS exposes every seller profile (public browse) — pin to the caller.
  const { data: profileRow } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profileRow) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Only approved sellers can create listings.
        </p>
      </div>
    );
  }

  const categories = await getCategories();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <div className="border-b border-gold/25 pb-6">
        <p className="editorial-kicker">Seller studio / New listing</p>
        <h1 className="mt-3 font-heading text-4xl font-normal tracking-tight md:text-5xl">Create a <em className="text-gold-soft">listing.</em></h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Save a draft, add up to six photos, then submit it for review.</p>
      </div>
      <ListingForm categories={categories} mode={{ kind: "create" }} />
    </div>
  );
}
