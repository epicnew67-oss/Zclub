import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "@/components/auth/auth-card";
import { listFinanceQueue } from "@/lib/topups/server";
import { FinanceTopupQueue } from "@/components/finance/topup-queue";

export const metadata = { title: "Admin · Top-ups" };

/**
 * The top-up review queue, in the admin panel. Manual (JazzCash /
 * Easypaisa) payments awaiting review live here with the buyer's email,
 * reference/transaction details and screenshot. Crypto payments
 * auto-credit on confirmation and appear only when flagged for a human
 * (underpaid, overpaid or refunded).
 */
export default async function AdminTopupsPage() {
  const { user } = await requireUser("/admin/topups");
  const supabase = await createClient();
  const [{ data: hasFinance }, { data: hasOwner }] = await Promise.all([
    supabase.rpc("user_has_role", { _role: "finance" }),
    supabase.rpc("user_has_role", { _role: "owner" }),
  ]);

  if (!hasFinance && !hasOwner) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Not authorized" subtitle="Finance or owner role required.">
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "unknown"}. Ask an owner to grant you the finance role.
          </p>
        </AuthCard>
      </div>
    );
  }

  const items = await listFinanceQueue();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Top-up <span className="text-gold">queue</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Manual (JazzCash / Easypaisa) payments awaiting review — each card
          shows the buyer&apos;s email, reference / transaction details and
          screenshot. Approving credits the ledger exactly once and writes the
          audit log. Crypto payments auto-credit on confirmation; they appear
          here only when flagged (underpaid, overpaid or refunded).
        </p>
      </header>

      <FinanceTopupQueue initialItems={items} />
    </div>
  );
}
