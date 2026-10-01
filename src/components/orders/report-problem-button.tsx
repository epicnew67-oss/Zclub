"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { openDisputeAction } from "@/app/orders/actions";

type Props = {
  bookingId: string;
  /** "buyer" / "seller" — used to localise the prompt. */
  role: "buyer" | "seller";
  /** Booking status. The button only renders when status === 'completed'. */
  status: string;
};

/**
 * "Report a problem" CTA inside the order status header.
 *
 * Opens a dialog with a reason textarea (≥10 chars, ≤1000). On submit
 * calls `open_dispute` which transitions booking → `disputed`, writes
 * a `disputes` row, an audit_log entry, and a notification for the
 * counterparty. The 24-hour release sweep will skip this booking until
 * support / finance / owner resolves the dispute.
 *
 * Disabled when status is anything other than `completed` (already
 * released, already disputed, cancelled, etc.). Once a dispute is open
 * the page re-renders with the new status and the button hides.
 */
export function ReportProblemButton({ bookingId, role, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "completed") return null;

  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (trimmed.length < 10) {
      setError("Reason must be at least 10 characters.");
      return;
    }
    if (trimmed.length > 1000) {
      setError("Reason must be 1000 characters or fewer.");
      return;
    }
    setBusy(true);
    const result = await openDisputeAction(bookingId, trimmed);
    setBusy(false);
    if (result.ok) {
      toast.success(
        role === "buyer"
          ? "Dispute opened. Support will reach out shortly."
          : "Dispute opened. Support will reach out shortly."
      );
      setOpen(false);
      setReason("");
      router.refresh();
    } else {
      const code = result.code;
      const message =
        code === "reason_too_short"
          ? "Reason must be at least 10 characters."
          : code === "reason_too_long"
            ? "Reason must be 1000 characters or fewer."
            : code === "already_disputed"
              ? "A dispute is already open on this booking."
              : code === "already_released"
                ? "The escrow has already been released — no dispute possible."
                : code === "wrong_state"
                  ? `This booking is in status "${String(result.status ?? "")}". Disputes are only available for completed bookings.`
                  : code === "not_participant"
                    ? "Only the buyer or the seller of this booking can open a dispute."
                    : "Could not open the dispute. Try again.";
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <AlertTriangleIcon className="mr-2 size-4" />
          Report a problem
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. Opening a dispute freezes the escrow
            so the seller doesn't receive the payout until support reviews
            it. We'll notify the other party and follow up by email.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reason" className="text-sm font-medium">
              What happened?
            </label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the issue in at least 10 characters. Be specific — it helps support resolve quickly."
              rows={5}
              maxLength={1000}
              disabled={busy}
              aria-invalid={tooShort || !!error}
              required
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{trimmed.length} / 1000</span>
              {tooShort ? (
                <span className="text-destructive">10 characters minimum</span>
              ) : null}
            </div>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || trimmed.length < 10}
            >
              {busy ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : null}
              Open dispute
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}