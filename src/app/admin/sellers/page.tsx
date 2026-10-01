import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import { listAdminApplications } from "@/lib/seller";
import { listSellers } from "@/lib/admin";
import { SellerAdminQueue } from "@/components/seller/seller-admin-queue";
import { AdminSellerList } from "@/components/admin/admin-seller-list";

export const metadata: Metadata = { title: "Seller applications" };

export default async function SellerAdminPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Seller applications" subtitle="Needs a configured Supabase — set .env.local.">
          <p className="text-sm text-muted-foreground">The admin tools unlock once Supabase is configured.</p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/admin/sellers");
  const adminCheck = await createClient();
  const { data: hasSupport } = await adminCheck.rpc("user_has_role", { _role: "support" });
  const { data: hasFinance } = await adminCheck.rpc("user_has_role", { _role: "finance" });
  const { data: hasOwner } = await adminCheck.rpc("user_has_role", { _role: "owner" });

  if (!hasSupport && !hasFinance && !hasOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Not authorized" subtitle="Admin role required.">
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "unknown"}. This page requires support, finance, or owner.
          </p>
        </AuthCard>
      </div>
    );
  }

  const [pending, all, sellers] = await Promise.all([
    listAdminApplications("pending"),
    listAdminApplications("all"),
    listSellers().catch(() => []),
  ]);

  const history = all.filter((a) => a.status !== "pending");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-16">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold md:text-4xl">
          Seller <span className="text-gold">applications</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Photos and details for each applicant. Approving grants the seller role, creates a
          seller profile + wallet, and notifies the buyer. Both actions write the audit log.
        </p>
      </header>
      <SellerAdminQueue pending={pending} history={history} />

      <section className="mt-12">
        <h2 className="font-heading text-2xl font-semibold">
          Approved <span className="text-gold">sellers</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify, suspend, reactivate, or soft-delete approved sellers. Soft delete is blocked
          when there is escrow or a pending / approved payout.
        </p>
        <div className="mt-4">
          <AdminSellerList sellers={sellers} />
        </div>
      </section>
    </div>
  );
}