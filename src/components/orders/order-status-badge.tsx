import { Badge } from "@/components/ui/badge";
import type { ComponentProps } from "react";

const STATUS_LABELS: Record<string, { label: string; variant: ComponentProps<typeof Badge>["variant"] }> = {
  paid: { label: "Paid", variant: "gold-outline" },
  scheduled: { label: "Scheduled", variant: "gold-outline" },
  live: { label: "Live", variant: "success" },
  completed: { label: "Completed", variant: "success" },
  released: { label: "Released", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  seller_no_show: { label: "Seller no-show", variant: "destructive" },
  disputed: { label: "Disputed", variant: "destructive" },
};

export function OrderStatusBadge({ status, role = "buyer" }: { status: string; role?: "buyer" | "seller" }) {
  const meta = role === "seller" && (status === "paid" || status === "scheduled")
    ? { label: "Slot booked", variant: "gold-outline" as const }
    : role === "seller" && status === "live"
      ? { label: "Video call running", variant: "success" as const }
      : STATUS_LABELS[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={meta.variant} aria-label={`Status: ${meta.label}`}>
      {meta.label}
    </Badge>
  );
}
