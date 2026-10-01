import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getCategories,
  getListingForSeller,
  signPhotoPaths,
} from "@/lib/listings";
import { ListingForm } from "@/components/seller/listing-form";

export const metadata: Metadata = { title: "Edit listing · Seller" };

type Params = { id: string };

export default async function EditListingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to edit a listing.
        </p>
      </div>
    );
  }

  const { user } = await requireUser(`/seller/listings/${id}/edit`);
  const supabase = await createClient();
  // RLS exposes every seller profile (public browse), so owning must be
  // pinned to the caller — without it maybeSingle() breaks once more
  // than one seller exists.
  const { data: profileRow } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profileRow) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Only approved sellers can edit listings.
        </p>
      </div>
    );
  }

  const listing = await getListingForSeller(profileRow.id, id);
  if (!listing) {
    notFound();
  }

  const [categories, signedMap] = await Promise.all([
    getCategories(),
    signPhotoPaths(listing.photos.map((p) => p.path)),
  ]);

  const existingPhotos = listing.photos.map((p) => ({
    id: p.id,
    path: p.path,
    url: signedMap.get(p.path) ?? null,
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          <span className="text-gold">Edit listing</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your listing. Submit it again for review when ready.
        </p>
      </div>
      <ListingForm
        categories={categories}
        mode={{
          kind: "edit",
          listingId: listing.id,
          initial: {
            title: listing.title,
            description: listing.description ?? "",
            categoryId: listing.category_id,
            durationMinutes: listing.duration_minutes,
            priceTokens: listing.price_tokens,
            status: listing.status,
          },
          existingPhotos,
        }}
      />
    </div>
  );
}