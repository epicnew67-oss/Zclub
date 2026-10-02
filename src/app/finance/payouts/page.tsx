import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import { listAllPayoutsForFinance } from "@/lib/post-call-money";
import { FinancePayoutsQueue } from "@/components/finance/payouts-queue";

export const metadata: Metadata = { title: "Finance · Payouts" };

export default async function FinancePayoutsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Finance"
          subtitle="Payouts queue needs a configured Supabase — set .env.local."
        >
          <p className="text-sm text-muted-foreground">
            The finance tools unlock once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/finance/payouts");

  const supabaseUserClient = await createClient();
  const { data: hasFinance } = await supabaseUserClient.rpc("user_has_role", {
    _role: "finance",
  });
  const { data: hasOwner } = await supabaseUserClient.rpc("user_has_role", {
    _role: "owner",
  });

  if (!hasFinance && !hasOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Not authorized" subtitle="Finance or owner role required.">
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "unknown"}. Ask an owner to grant you the
            finance role to access this page.
          </p>
        </AuthCard>
      </div>
    );
  }

  const items = await listAllPayoutsForFinance([
    "pending",
    "approved",
    "paid",
    "rejected",
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-16">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold md:text-4xl">
          Payouts <span className="text-gold">queue</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sellers request withdrawals; finance approves and marks the
          transfer paid with a reference. Approving is reversible until
          &quot;mark paid&quot; runs (which debits the seller ledger exactly once,
          idempotent on replay).
        </p>
      </header>
      <FinancePayoutsQueue initialItems={items} />
    </div>
  );
}