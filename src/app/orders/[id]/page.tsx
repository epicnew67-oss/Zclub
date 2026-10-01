import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CalendarIcon, CoinsIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { getOrderForUser, listChatMessages } from "@/lib/bookings";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderChat } from "@/components/orders/order-chat";
import { OrderStatusHeader } from "@/components/orders/order-status-header";
import { AuthCard } from "@/components/auth/auth-card";
import { Badge } from "@/components/ui/badge";

type Params = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Order ${id.slice(0, 8)}` };
}

function formatLocal(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Almost there"
          subtitle="Supabase isn't configured."
        >
          <p className="text-sm text-muted-foreground">
            Connect Supabase to view this order.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { id } = await params;
  const { user } = await requireUser(`/orders/${id}`);
  const order = await getOrderForUser(id, user.id);
  if (!order) notFound();

  const initialMessages = await listChatMessages(order.chatId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
      <Link
        href={order.role === "seller" ? "/seller/orders" : "/orders"}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-gold"
      >
        <ArrowLeftIcon className="size-3" /> Back to orders
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={order.role === "buyer" ? "gold-outline" : "outline"}>
            {order.role === "buyer" ? "Buying" : "Selling"}
          </Badge>
          <OrderStatusBadge status={order.status} />
          <span className="text-xs text-muted-foreground">Order {order.id.slice(0, 8)}</span>
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          {order.listing.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          with{" "}
          <span className="text-foreground/90">
            {order.role === "buyer" ? order.seller.displayName : order.buyer.displayName}
          </span>{" "}
          · <CalendarIcon className="inline size-3.5 align-text-bottom" />{" "}
          {formatLocal(order.slot.startsAt)}
        </p>
      </header>

      <OrderStatusHeader order={order} />

      <OrderChat
        chatId={order.chatId}
        bookingId={order.id}
        currentUserId={user.id}
        buyerId={order.buyer.id}
        sellerId={order.seller.id}
        buyerName={order.buyer.displayName}
        sellerName={order.seller.displayName}
        status={order.status}
        slotStartsAt={order.slot.startsAt}
        slotEndsAt={order.slot.endsAt}
        initialMessages={initialMessages}
      />

      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CoinsIcon className="size-3 text-gold" /> {order.priceTokens.toLocaleString()} tokens escrowed
        </span>
        <Link href="/wallet" className="hover:text-gold">
          Wallet →
        </Link>
      </div>
    </div>
  );
}
