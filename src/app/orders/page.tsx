import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, CoinsIcon, ShoppingBagIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { listBuyerOrders } from "@/lib/bookings";
import { LocalDateTime } from "@/components/local-date-time";
import { AuthCard } from "@/components/auth/auth-card";
import { BalanceChip } from "@/components/wallet/balance-chip";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
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

export const metadata: Metadata = { title: "Your orders" };


export default async function OrdersPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Almost there"
          subtitle="Supabase isn't configured — set your keys in .env.local."
        >
          <p className="text-sm text-muted-foreground">
            Your orders will appear here once Supabase is connected.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { supabase, user } = await requireUser("/orders");
  const [{ data: wallet }, { data: balanceResult }, orders] = await Promise.all([
    supabase.from("wallets").select("id").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("get_own_wallet_balance"),
    listBuyerOrders(user.id),
  ]);

  const balance = typeof balanceResult === "number" ? balanceResult : 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10 md:px-6 md:py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge variant="gold-outline">Orders</Badge>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-4xl">
            Your <span className="text-gold">orders</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every call you&apos;ve booked. Open one to chat, join your call, or manage a booking that has not started.
          </p>
        </div>
        <BalanceChip
          walletId={wallet?.id ?? null}
          initialBalance={balance}
          signedIn
        />
      </header>

      <Separator className="bg-gold/15" />

      {orders.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBagIcon className="size-5 text-gold" /> No orders yet
            </CardTitle>
            <CardDescription>
              When you book a slot, it lands here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="bg-burgundy hover:bg-burgundy/90">
              <Link href="/browse">
                Browse listings <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="group block rounded-xl border border-border/70 bg-surface/40 p-4 transition-colors hover:border-gold/40 hover:bg-gold/5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-heading text-base text-foreground">
                      {order.listingTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      with{" "}
                      <span className="text-foreground/90">
                        {order.counterparty.displayName}
                      </span>{" "}
                      · <LocalDateTime value={order.slotStart} />
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <span className="font-medium text-foreground tabular-nums">
                      {order.priceTokens.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">tokens</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CoinsIcon className="size-3 text-gold" /> {orders.length} order
          {orders.length === 1 ? "" : "s"}
        </span>
        <Link href="/wallet" className="hover:text-gold">
          Open wallet →
        </Link>
      </div>
    </div>
  );
}
