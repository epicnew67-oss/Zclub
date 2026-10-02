import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import {
  fetchUsdPerPkr,
  getManualAccount,
  getTokenPacks,
  sanitizeReturnUrl,
} from "@/lib/topups/server";
import { TopupFlow } from "@/components/topup/topup-flow";

export const metadata: Metadata = { title: "Top up" };

export default async function TopupPage({
  searchParams,
}: {
  searchParams: Promise<{
    needed?: string;
    return?: string;
    pack?: string;
  }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Wallet"
          subtitle="Top-ups need a configured Supabase — set .env.local."
        >
          <p className="text-sm text-muted-foreground">
            The wallet unlocks once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { supabase, user } = await requireUser("/wallet/topup");
  void supabase;

  const params = await searchParams;
  const needed =
    params.needed && Number.isFinite(Number(params.needed))
      ? Math.max(0, Math.floor(Number(params.needed)))
      : null;
  const returnUrl = sanitizeReturnUrl(params.return);

  // Crypto is priced in USD: use the current live PKR→USD rate (same
  // source the payment creation locks in — nothing hardcoded).
  const [packs, rateInfo] = await Promise.all([
    getTokenPacks(),
    fetchUsdPerPkr(),
  ]);
  const usdPerPkr = rateInfo.rate;

  // Pre-select the cheapest pack that covers `needed` (tokens >= needed).
  let preselectedPackId: string | null = null;
  if (needed != null && needed > 0) {
    const covering = packs
      .filter((pack) => pack.tokens >= needed)
      .sort((a, b) => a.price_pkr - b.price_pkr);
    preselectedPackId = covering[0]?.id ?? null;
  } else if (params.pack) {
    // Allow explicit pack selection (e.g. from a pack card "Top up" CTA).
    preselectedPackId = packs.some((p) => p.id === params.pack)
      ? params.pack
      : null;
  }

  const accounts = await Promise.all([
    getManualAccount("jazzcash"),
    getManualAccount("easypaisa"),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 md:px-6 md:py-16">
      <header>
        <h1 className="font-heading text-3xl font-semibold md:text-4xl">
          Top up <span className="text-gold">tokens</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Pick a pack from the list below, then choose how you&apos;d like to pay. 1
          PKR = 2 tokens. Card payments are not available.
        </p>
        {needed != null && needed > 0 ? (
          <p className="mt-3 inline-flex rounded-full bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
            You need {needed.toLocaleString("en-US")} tokens — the
            {preselectedPackId
              ? " smallest covering pack is pre-selected"
              : " amount exceeds our largest pack; pick the largest or come back with a smaller amount"}
            .
          </p>
        ) : null}
      </header>

      <TopupFlow
        packs={packs}
        preselectedPackId={preselectedPackId}
        neededTokens={needed}
        returnUrl={returnUrl}
        userId={user.id}
        usdPerPkr={usdPerPkr}
        accounts={{
          jazzcash: accounts[0],
          easypaisa: accounts[1],
        }}
      />
    </div>
  );
}
