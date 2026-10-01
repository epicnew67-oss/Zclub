import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import { listFinanceQueue } from "@/lib/topups/server";
import { FinanceTopupQueue } from "@/components/finance/topup-queue";

export const metadata: Metadata = { title: "Finance · Top-ups" };

export default async function FinanceTopupsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Finance" subtitle="Top-ups queue needs a configured Supabase — set .env.local.">
          <p className="text-sm text-muted-foreground">The finance tools unlock once Supabase is configured.</p>
        </AuthCard>
      </div>
    );
  }

  const { supabase, user } = await requireUser("/finance/topups");

  const supabaseUserClient = await createClient();
  const { data: hasFinance, error: financeError } = await supabaseUserClient.rpc(
    "user_has_role",
    { _role: "finance" }
  );
  const { data: hasOwner, error: ownerError } = await supabaseUserClient.rpc(
    "user_has_role",
    { _role: "owner" }
  );
  if (financeError) throw financeError;
  if (ownerError) throw ownerError;

  if (!hasFinance && !hasOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Not authorized" subtitle="Finance or owner role required.">
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "unknown"}. Ask an owner to grant you the finance role to access this page.
          </p>
        </AuthCard>
      </div>
    );
  }

  void supabase;
  const items = await listFinanceQueue();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-16">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold md:text-4xl">
          Top-ups <span className="text-gold">queue</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manual payments awaiting review. Approving credits the ledger exactly
          once (idempotent) and writes the audit log. Underpaid/overpaid crypto
          payments flagged as needs-review appear here too.
        </p>
      </header>
      <FinanceTopupQueue initialItems={items} />
    </div>
  );
}
