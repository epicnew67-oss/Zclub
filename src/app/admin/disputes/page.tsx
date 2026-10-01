import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import {
  getDisputeBookingBundle,
  listAllDisputesForAdmin,
  listBookingMessagesForDispute,
} from "@/lib/post-call-money";
import { AdminDisputesManager, type DisputeCardData } from "@/components/admin/disputes-manager";

export const metadata: Metadata = { title: "Admin · Disputes" };

export default async function AdminDisputesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Admin · disputes" subtitle="Needs a configured Supabase — set .env.local.">
          <p className="text-sm text-muted-foreground">
            The admin tools unlock once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/admin/disputes");
  const supabaseUserClient = await createClient();
  const [{ data: hasSupport }, { data: hasFinance }, { data: hasOwner }] =
    await Promise.all([
      supabaseUserClient.rpc("user_has_role", { _role: "support" }),
      supabaseUserClient.rpc("user_has_role", { _role: "finance" }),
      supabaseUserClient.rpc("user_has_role", { _role: "owner" }),
    ]);

  if (!hasSupport && !hasFinance && !hasOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Not authorized" subtitle="Support, finance, or owner role required.">
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "unknown"}.
          </p>
        </AuthCard>
      </div>
    );
  }

  const disputes = await listAllDisputesForAdmin();

  // Fetch the booking bundles + chat messages for each dispute. Limit
  // the active set to the first 25 to keep the page small; the
  // recently-resolved list only shows dispute metadata (no chat).
  const cards: DisputeCardData[] = [];
  for (const d of disputes.slice(0, 25)) {
    const bundle = await getDisputeBookingBundle(d.booking_id);
    if (!bundle) continue;
    let messages: DisputeCardData["messages"] = [];
    if (bundle.chatId) {
      try {
        messages = await listBookingMessagesForDispute(bundle.chatId);
      } catch {
        messages = [];
      }
    }
    cards.push({
      dispute: d,
      booking: bundle.booking,
      slot: bundle.slot,
      listing: bundle.listing,
      buyer: bundle.buyer,
      seller: bundle.seller,
      messages,
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-16">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold md:text-4xl">
          Disputes <span className="text-gold">queue</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Booking escrow is frozen when a dispute opens. Read the chat
          history (opening the chat requires a reason that's logged in
          the resolution note), then resolve as refund / release / split.
          Every resolution writes an audit log row and notifies both
          parties.
        </p>
      </header>
      <AdminDisputesManager initialCards={cards} />
    </div>
  );
}