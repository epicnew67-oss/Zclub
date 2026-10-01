import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listPendingReviewListings, listAdminListingsHistory, getCategories } from "@/lib/listings";
import { AdminListingsManager } from "@/components/admin/admin-listings-manager";

export const metadata: Metadata = { title: "Admin · Listings" };

export default async function AdminListingsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to moderate listings.
        </p>
      </div>
    );
  }

  await requireUser("/admin/listings");
  const supabase = await createClient();
  const { data: hasSupport } = await supabase.rpc("user_has_role", { _role: "support" });
  const { data: hasFinance } = await supabase.rpc("user_has_role", { _role: "finance" });
  const { data: hasOwner } = await supabase.rpc("user_has_role", { _role: "owner" });

  if (!hasSupport && !hasFinance && !hasOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          You need support, finance, or owner role to moderate listings.
        </p>
      </div>
    );
  }

  const [pending, approved, categories] = await Promise.all([
    listPendingReviewListings(),
    listAdminListingsHistory(),
    getCategories(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          <span className="text-gold">Listings moderation</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review pending listings. Approve, reject with reason, edit, or unpublish. Every action is recorded in the audit log with a before/after diff.
        </p>
      </div>
      <AdminListingsManager
        pending={pending}
        approved={approved}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}