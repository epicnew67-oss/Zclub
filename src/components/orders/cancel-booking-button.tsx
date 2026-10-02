"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2Icon, XCircleIcon } from "lucide-react";
import { cancelBookingAction } from "@/app/orders/actions";
import { Button } from "@/components/ui/button";

/**
 * Cancel booking — inline two-click confirm pattern.
 *
 * First click arms the confirmation; second click fires the server
 * action. Esc or clicking elsewhere collapses it. No dialog dependency.
 */
export function CancelBookingButton({ bookingId, role, priceTokens, isOnDemand = false }: { bookingId: string; role: "buyer" | "seller"; priceTokens: number; isOnDemand?: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  function fire() {
    startTransition(async () => {
      const result = await cancelBookingAction(bookingId);
      if (result.ok) {
        const refunded = result.refundedBuyer;
        const toSeller = result.releasedSeller;
        const tail = toSeller > 0 ? ` Seller received ${toSeller.toLocaleString()} compensation.` : "";
        toast.success(`Cancelled. ${refunded.toLocaleString()} tokens refunded.${tail}`);
        router.refresh();
      } else {
        switch (result.code) {
          case "call_started":
            toast.error("The call has started. Open a dispute from this order if there is a problem.");
            break;
          case "already_finalized":
            toast.error("This order is already finalized.");
            break;
          case "not_participant":
            toast.error("You can't cancel this order.");
            break;
          default:
            toast.error("Could not cancel. Try again.");
        }
      }
      setArmed(false);
    });
  }

  if (!armed) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setArmed(true)}
        className="border-destructive/40 text-destructive hover:bg-destructive/10"
      >
        <XCircleIcon data-icon="inline-start" /> Cancel booking
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs">
      <span className="text-destructive">
        {role === "seller" ? `Cancel and refund the buyer ${priceTokens} tokens?` : isOnDemand ? `Cancel and refund ${priceTokens} tokens now?` : "Cancel this order? Your refund follows the cancellation policy."}
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => setArmed(false)}
        disabled={pending}
      >
        Keep
      </Button>
      <Button
        type="button"
        size="xs"
        className="bg-destructive text-foreground hover:bg-destructive/90"
        onClick={fire}
        disabled={pending}
      >
        {pending ? <Loader2Icon className="size-3 animate-spin" /> : "Yes, cancel"}
      </Button>
    </div>
  );
}
