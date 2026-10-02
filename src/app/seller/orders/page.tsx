import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ListChecksIcon, ShoppingBagIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { getSellerStatus } from "@/lib/seller";
import { listSellerOrders } from "@/lib/bookings";
import { LocalDateTime } from "@/components/local-date-time";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Seller orders" };


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
    <div className="mx-auto w-full max-w-6xl space-y-7 px-5 py-10 md:px-8 md:py-16">

        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/25 pb-7">
          <div>
            <p className="editorial-kicker">Seller studio / Calls</p>
            <h1 className="mt-4 font-heading text-5xl leading-none font-normal md:text-6xl">
              Your <em className="text-gold-soft">calls.</em>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Bookings on your listings. Open one to chat with the buyer or
              join the video call. Earnings arrive automatically when it ends.
            </p>
          </div>
          <div className="rounded-sm border border-gold/40 bg-gold/5 px-4 py-2 text-sm">
            <span className="font-medium tabular-nums text-gold">
              {balance.toLocaleString()}
            </span>{" "}
            <span className="text-xs text-muted-foreground">tokens</span>
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
                When a buyer books one of your services, it lands here.
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
                  className="group block rounded-sm border border-border/70 bg-surface/70 p-5 transition-colors hover:border-gold/50 hover:bg-gold/5"
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
                        · {order.isOnDemand ? "On-demand call" : <LocalDateTime value={order.slotStart} />}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <OrderStatusBadge status={order.status} role="seller" isOnDemand={order.isOnDemand} />
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
    </div>
  );
}
