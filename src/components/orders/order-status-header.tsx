import { ClockIcon, CoinsIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CancelBookingButton } from "@/components/orders/cancel-booking-button";
import { ReportProblemButton } from "@/components/orders/report-problem-button";
import { LocalDateTime } from "@/components/local-date-time";
import type { OrderDetail } from "@/lib/bookings";


function durationMinutes(startsIso: string, endsIso: string) {
  return Math.max(
    0,
    Math.round((new Date(endsIso).getTime() - new Date(startsIso).getTime()) / 60000)
  );
}

export function OrderStatusHeader({ order }: { order: OrderDetail }) {
  const minutes = durationMinutes(order.slot.startsAt, order.slot.endsAt);
  const cancellable = (order.status === "paid" || order.status === "scheduled") && !order.callStarted;
  const reportable = order.status === "live" || order.status === "completed";

  return (
    <Card variant="glow" className="p-5">
      <CardContent className="grid gap-4 px-0 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          {order.isOnDemand ? <div className="rounded-xl border border-gold/20 bg-gold/5 p-3">
            <p className="font-medium text-foreground">{order.status === "paid" ? "Call booked — ready to join" : order.status === "live" ? "Video call running" : order.status === "released" ? "Call complete — seller paid" : "On-demand call"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{order.role === "buyer" && order.sellerJoinedAt ? `${order.seller.displayName} is in the call. Join now.` : order.role === "seller" && order.buyerJoinedAt ? `${order.buyer.displayName} is in the call. Join now.` : "Either person can join from this order."}</p>
          </div> : <div>
            <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
              When
            </p>
            <p className="mt-0.5 font-heading text-base text-foreground">
              <LocalDateTime value={order.slot.startsAt} />
            </p>
            <p className="text-xs text-muted-foreground">
              ends <LocalDateTime value={order.slot.endsAt} />
            </p>
          </div>}
          <ul className="grid gap-2 text-sm md:grid-cols-3">
            <li className="flex items-center gap-2 text-foreground/90">
              <ClockIcon className="size-4 text-gold" /> {order.isOnDemand ? "Video call" : `${minutes} min`}
            </li>
            <li className="flex items-center gap-2 text-foreground/90">
              <CoinsIcon className="size-4 text-gold" />{" "}
              {order.priceTokens.toLocaleString()} tokens held
            </li>
            <li className="flex items-center gap-2 text-foreground/90">
              <ShieldCheckIcon className="size-4 text-gold" />
              Refund if seller no-shows
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap items-start gap-2 md:justify-end">
          {reportable ? (
            <ReportProblemButton
              bookingId={order.id}
              role={order.role}
              status={order.status}
            />
          ) : null}
          {cancellable ? (
            <CancelBookingButton bookingId={order.id} role={order.role} priceTokens={order.priceTokens} isOnDemand={order.isOnDemand} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
