import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import {
  getTopupForUser,
  sanitizeReturnUrl,
  syncCryptoPaymentForTopup,
} from "@/lib/topups/server";
import { TopupStatus } from "@/components/topup/topup-status";

export const metadata: Metadata = { title: "Payment status" };

export default async function TopupStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; return?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Wallet" subtitle="Top-ups need a configured Supabase — set .env.local.">
          <p className="text-sm text-muted-foreground">The wallet unlocks once Supabase is configured.</p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/wallet/topup/status");
  const params = await searchParams;
  const topupId = typeof params.id === "string" ? params.id : "";
  const returnUrl = sanitizeReturnUrl(params.return);

  if (!topupId) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6 md:py-16">
        <AuthCard title="Top-up not found" subtitle="We couldn't locate that payment.">
          <p className="text-sm text-muted-foreground">Check your wallet or start a new top-up.</p>
        </AuthCard>
      </div>
    );
  }

  let data = await getTopupForUser(user.id, topupId);
  if (data?.topup.method === "crypto" && data.payment?.pay_address) {
    // Self-heal on load: pull the live NOWPayments status — applied
    // through the same idempotent, server-verified credit path as the
    // IPN — before rendering, so the screen shows the true status.
    await syncCryptoPaymentForTopup(topupId).catch(() => null);
    data = (await getTopupForUser(user.id, topupId)) ?? data;
  }
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6 md:py-16">
        <AuthCard title="Top-up not found" subtitle="This payment belongs to a different account or doesn't exist.">
          <p className="text-sm text-muted-foreground">Double-check your wallet status.</p>
        </AuthCard>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6 md:py-16">
      <TopupStatus
        userId={user.id}
        topup={data.topup}
        payment={data.payment}
        pack={data.pack}
        returnUrl={returnUrl}
      />
    </div>
  );
}
