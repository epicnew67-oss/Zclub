import type { ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "@/components/auth/auth-card";
import { SellerSidebar, SellerMobileNav } from "@/components/seller/seller-sidebar";

export default async function SellerLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Seller dashboard"
          subtitle="Needs a configured Supabase — set .env.local."
        >
          <p className="text-sm text-muted-foreground">
            The seller dashboard unlocks once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/seller");
  const supabase = await createClient();
  const { data: hasSeller } = await supabase.rpc("user_has_role", {
    _role: "seller",
  });

  if (!hasSeller) {
    const { data: hasPending } = await supabase
      .from("seller_applications")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard
          title={hasPending ? "Application under review" : "Not a seller yet"}
          subtitle={
            hasPending
              ? "You'll be notified when we've reviewed your application."
              : "Apply to start selling."
          }
        >
          <p className="text-sm text-muted-foreground">
            {hasPending
              ? "Revisit /become-a-seller for status. One pending application at a time."
              : "Only approved sellers can access the seller dashboard."}
          </p>
          {!hasPending ? (
            <div className="mt-4">
              <a
                href="/become-a-seller"
                className="text-sm font-medium text-gold hover:underline"
              >
                Apply to become a seller →
              </a>
            </div>
          ) : null}
        </AuthCard>
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <SellerSidebar />
      <main className="flex-1 min-w-0">
        <SellerMobileNav />
        {children}
      </main>
    </div>
  );
}