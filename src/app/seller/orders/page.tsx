import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ListChecksIcon, ShoppingBagIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSellerStatus } from "@/lib/seller";
import { listSellerOrders } from "@/lib/bookings";
import { SellerSidebar, SellerMobileNav } from "@/components/seller/seller-sidebar";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { AuthCard } from "@/components/auth/auth-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Seller orders" };

function formatLocal(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SellerOrdersPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Almost there"
          subtitle="Supabase isn't configured."
        >
          <p className="text-sm text-muted-foreground">
            Seller orders appear here once Supabase is connected.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { supabase, user } = await requireUser("/seller/orders");
  const status = await getSellerStatus(user.id);
  if (!status.isSeller) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Only approved sellers can access seller orders.
        </p>
      </div>
    );
  }

  const [{ data: balanceResult }, orders] = await Promise.all([
    supabase.rpc("get_own_wallet_balance"),
    listSellerOrders(user.id),
  ]);
  const balance = typeof balanceResult === "number" ? balanceResult : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-0 md:flex-row md:px-4 md:py-8">
      <SellerSidebar />
      <main className="min-w-0 flex-1 space-y-6 px-4 py-6 md:px-6 md:py-0">
        <SellerMobileNav />

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Badge variant="gold-outline">Seller orders</Badge>
            <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-4xl">
              Your <span className="text-gold">calls</span>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Bookings on your listings. Open one to chat with the buyer or
              release tokens once the call completes.
            </p>
          </div>
          <div className="rounded-full border border-gold/40 bg-gold/5 px-4 py-1.5 text-sm">
            <span className="font-medium tabular-nums text-gold">
              {balance.toLocaleString()}
            </span>{" "}
            <span className="text-xs text-muted-foreground">tokens earned</span>
          </div>
        </header>

        <Separator className="bg-gold/15" />

        {orders.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBagIcon className="size-5 text-gold" /> No bookings yet
              </CardTitle>
              <CardDescription>
                When a buyer reserves one of your slots, it lands here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="bg-burgundy hover:bg-burgundy/90">
                <Link href="/seller/listings">
                  <ListChecksIcon data-icon="inline-start" /> Manage listings
                  <ArrowRightIcon data-icon="inline-end" />
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
                        · {formatLocal(order.slotStart)}
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
      </main>
    </div>
  );
}
