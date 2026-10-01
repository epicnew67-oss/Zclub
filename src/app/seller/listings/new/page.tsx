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

  await requireUser("/seller/listings/new");
  const supabase = await createClient();
  const { data: profileRow } = await supabase
    .from("seller_profiles")
    .select("id")
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
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          <span className="text-gold">New listing</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Save a draft, upload up to 6 photos, then submit for review. Your first listing always needs admin approval.
        </p>
      </div>
      <ListingForm categories={categories} mode={{ kind: "create" }} />
    </div>
  );
}