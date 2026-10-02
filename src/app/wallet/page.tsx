import type { Metadata } from "next";
import Link from "next/link";
import { CoinsIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { LedgerHistory, type LedgerRow } from "@/components/wallet/ledger-history";
import { TopupHistory, type TopupHistoryRow } from "@/components/wallet/topup-history";
import { SellerWalletPanel } from "@/components/wallet/seller-wallet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getSellerWalletSummary,
  listSellerPayouts,
} from "@/lib/post-call-money";

export const metadata: Metadata = { title: "Wallet" };

const PAGE_SIZE = 15;

function formatPkEquivalent(tokens: number) {
  // 1 PKR = 2 tokens, so tokens -> PKR = tokens / 2.
  const pkr = tokens / 2;
  return pkr.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Almost there"
          subtitle="Supabase isn't configured — set your keys in .env.local."
        >
          <p className="text-sm text-muted-foreground">
            The wallet unlocks once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { supabase, user } = await requireUser("/wallet");
  const params = await searchParams;
  const filter = params.type && params.type !== "all" ? params.type : null;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Parallel reads: balance, wallet id, ledger page, role checks for the
  // seller panel, payout min setting, seller summary, payout history.
  const [
    balanceResult,
    walletResult,
    ledgerResult,
    hasSellerResult,
    payoutMinResult,
    topupsResult,
  ] = await Promise.all([
    supabase.rpc("get_own_wallet_balance"),
    supabase.from("wallets").select("id").eq("user_id", user.id).maybeSingle(),
    filter
      ? supabase
          .from("ledger_entries")
          .select("*", { count: "exact" })
          .eq("entry_type", filter)
          .order("created_at", { ascending: false })
          .range(from, to)
      : supabase
          .from("ledger_entries")
          .select("*", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(from, to),
    supabase.rpc("user_has_role", { _role: "seller" }),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "payout_min_tokens")
      .maybeSingle(),
    supabase
      .from("topup_requests")
      .select("id, method, tokens, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const isSeller = hasSellerResult.data === true;
  const minTokens =
    (payoutMinResult.data?.value as { min?: number } | null)?.min ?? 1000;

  // Fetch seller-specific data only when needed.
  let sellerSummary: Awaited<
    ReturnType<typeof getSellerWalletSummary>
  > | null = null;
  let sellerPayouts: Awaited<ReturnType<typeof listSellerPayouts>> = [];
  if (isSeller) {
    [sellerSummary, sellerPayouts] = await Promise.all([
      getSellerWalletSummary(user.id),
      listSellerPayouts(user.id),
    ]);
  }

  const balance = typeof balanceResult.data === "number" ? balanceResult.data : 0;
  const walletId = walletResult.data?.id ?? null;
  const rows = (ledgerResult.data ?? []) as LedgerRow[];
  const total = ledgerResult.count ?? rows.length;
  const topups = (topupsResult.data ?? []) as TopupHistoryRow[];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10 md:px-6 md:py-16">
      <header>
        <Badge variant="gold-outline">Wallet</Badge>
        <h1 className="mt-3 font-heading text-3xl font-semibold md:text-4xl">
          Your <span className="text-gold">balance</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Tokens from purchases, refunds, and completed calls appear here.
          Your balance updates automatically.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card variant="gold" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CoinsIcon className="size-5 text-gold" /> Current balance
            </CardTitle>
            <CardDescription>
              Tokens you can use now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-heading text-5xl font-semibold tabular-nums text-gold md:text-6xl">
                {balance.toLocaleString("en-US")}
              </span>
              <span className="text-lg text-muted-foreground">tokens</span>
            </div>
            <Separator />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs tracking-wider text-muted-foreground uppercase">
                  PKR equivalent
                </dt>
                <dd className="mt-1 font-medium tabular-nums">
                  PKR {formatPkEquivalent(balance)}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wider text-muted-foreground uppercase">
                  Rate
                </dt>
                <dd className="mt-1 font-medium tabular-nums">1 PKR = 2 tokens</dd>
              </div>
            </dl>
            <div>
              <Button asChild className="shadow-gold">
                <Link href="/wallet/topup">Top up</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card variant="glow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-gold" /> Safety
            </CardTitle>
            <CardDescription>
              How we protect your tokens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="text-foreground">Every change is recorded.</span>{" "}
              Your token activity stays visible.
            </p>
            <p>
              <span className="text-foreground">Payments are counted once.</span>{" "}
              Repeated payment notices do not add tokens twice.
            </p>
            <p>
              <span className="text-foreground">You cannot overspend.</span>{" "}
              A purchase fails if you do not have enough tokens.
            </p>
          </CardContent>
        </Card>
      </div>

      {isSeller && sellerSummary ? (
        <SellerWalletPanel
          summary={sellerSummary}
          payouts={sellerPayouts}
          minTokens={minTokens}
        />
      ) : null}

      <TopupHistory rows={topups} />

      {walletId ? (
        <LedgerHistory
          walletId={walletId}
          initialRows={rows}
          initialCount={total}
          isSeller={isSeller}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Token activity</CardTitle>
            <CardDescription>
              Your wallet isn&apos;t initialized yet. Sign out and back in to
              provision it.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="flex justify-center pt-2">
        <Button asChild variant="ghost">
          <Link href="/account">
            <SparklesIcon data-icon="inline-start" /> Back to account
          </Link>
        </Button>
      </div>
    </div>
  );
}
