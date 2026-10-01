import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listApprovedListingsWithSlots } from "@/lib/listings";
import { AvailabilityManager } from "@/components/seller/availability-manager";

export const metadata: Metadata = { title: "Availability · Seller" };

export default async function SellerAvailabilityPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to manage availability.
        </p>
      </div>
    );
  }

  const { user } = await requireUser("/seller/availability");
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
          Only approved sellers can manage availability.
        </p>
      </div>
    );
  }

  const { listings, slots } = await listApprovedListingsWithSlots(profileRow.id);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          <span className="text-gold">Availability</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add and remove time slots. Slots are stored in UTC and shown in your local time.
        </p>
      </div>
      <AvailabilityManager listings={listings} slots={slots} />
    </div>
  );
}