import { ClockIcon, CoinsIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CancelBookingButton } from "@/components/orders/cancel-booking-button";
import { ReportProblemButton } from "@/components/orders/report-problem-button";
import { upperMeridiem } from "@/lib/datetime-format";
import type { OrderDetail } from "@/lib/bookings";

function formatLocal(iso: string) {
  return upperMeridiem(
    new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
}

function durationMinutes(startsIso: string, endsIso: string) {
  return Math.max(
    0,
    Math.round((new Date(endsIso).getTime() - new Date(startsIso).getTime()) / 60000)
  );
}

export function OrderStatusHeader({ order }: { order: OrderDetail }) {
  const minutes = durationMinutes(order.slot.startsAt, order.slot.endsAt);
  const cancellable = order.status === "paid" || order.status === "scheduled";
  const reportable = order.status === "completed";

  return (
    <Card variant="glow" className="p-5">
      <CardContent className="grid gap-4 px-0 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
              When
            </p>
            <p className="mt-0.5 font-heading text-base text-foreground">
              {formatLocal(order.slot.startsAt)}
            </p>
            <p className="text-xs text-muted-foreground">
              ends {formatLocal(order.slot.endsAt)}
            </p>
          </div>
          <ul className="grid gap-2 text-sm md:grid-cols-3">
            <li className="flex items-center gap-2 text-foreground/90">
              <ClockIcon className="size-4 text-gold" /> {minutes} min
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
            <CancelBookingButton bookingId={order.id} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
