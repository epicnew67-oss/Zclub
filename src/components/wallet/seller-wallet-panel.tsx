"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  ArrowDownToLineIcon,
  BanknoteIcon,
  CoinsIcon,
  HourglassIcon,
  Loader2Icon,
  LockIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  cancelPayoutAction,
  requestPayoutAction,
} from "@/app/wallet/actions";
import type { PayoutRow } from "@/lib/post-call-money";

type Props = {
  summary: {
    user_id: string;
    balance: number;
    available: number;
    in_escrow: number;
    pending_payout: number;
    approved_payout: number;
    paid_payout: number;
  };
  payouts: PayoutRow[];
  minTokens: number;
};

const STATUS_LABELS: Record<PayoutRow["status"], { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "border-gold/40 text-gold" },
  approved: { label: "Approved · awaiting payment", tone: "border-gold/40 text-gold" },
  paid: { label: "Paid", tone: "border-emerald-500/40 text-emerald-400" },
  rejected: { label: "Rejected", tone: "border-destructive/40 text-destructive" },
  cancelled: { label: "Cancelled", tone: "border-muted text-muted-foreground" },
};

function fmt(amount: number) {
  return amount.toLocaleString("en-US");
}

export function SellerWalletPanel({ summary, payouts, minTokens }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const parsed = Number(amount.replace(/[^\d]/g, "")) || 0;
  const aboveMin = parsed >= minTokens;
  const fitsAvailable = parsed <= summary.available;

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!aboveMin || !fitsAvailable || parsed <= 0) return;
    startTransition(async () => {
      const res = await requestPayoutAction(parsed);
      if (res.ok) {
        toast.success("Payout request submitted. Finance will review it.");
        setAmount("");
        router.refresh();
      } else {
        const code = res.code;
        const message =
          code === "below_min"
            ? `Minimum withdrawal is ${(res as { min?: number }).min?.toLocaleString() ?? minTokens} tokens.`
            : code === "INSUFFICIENT_AVAILABLE"
              ? `Only ${(res as { have?: number }).have?.toLocaleString() ?? "?"} tokens are available right now (pending payouts already reserved).`
              : code === "not_a_seller"
                ? "Only active sellers can request payouts."
                : code === "bad_amount"
                  ? "Enter a positive whole number."
                  : "Could not request payout. Try again.";
        toast.error(message);
      }
    });
  }

  async function handleCancel(id: string) {
    setBusyId(id);
    const res = await cancelPayoutAction(id);
    setBusyId(null);
    if (res.ok) {
      toast.success("Payout request cancelled.");
      router.refresh();
    } else {
      toast.error("Could not cancel that request.");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Badge variant="gold-outline">Seller wallet</Badge>
        <h2 className="mt-3 font-heading text-2xl font-semibold md:text-3xl">
          Available · in escrow · pending
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Earnings land in your wallet after the 24-hour dispute window
          closes (commission deducted). Until then they sit in escrow.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="gold">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CoinsIcon className="size-4 text-gold" /> Available
            </CardTitle>
            <CardDescription>
              Tokens you can withdraw right now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums text-gold md:text-4xl">
              {fmt(summary.available)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Balance {fmt(summary.balance)} − pending {fmt(summary.pending_payout)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockIcon className="size-4 text-gold" /> In escrow
            </CardTitle>
            <CardDescription>
              Held for bookings currently in flight.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums md:text-4xl">
              {fmt(summary.in_escrow)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Released after the dispute window closes (24h post-call).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HourglassIcon className="size-4 text-gold" /> Pending payout
            </CardTitle>
            <CardDescription>
              Withdrawal requests awaiting finance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums md:text-4xl">
              {fmt(summary.pending_payout)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Approved {fmt(summary.approved_payout)} · Paid (lifetime){" "}
              {fmt(summary.paid_payout)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BanknoteIcon className="size-4 text-gold" /> Request a withdrawal
          </CardTitle>
          <CardDescription>
            Minimum {minTokens.toLocaleString("en-US")} tokens. Finance
            approves manually and marks the transfer paid with a reference.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleRequest}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1.5">
              <label htmlFor="payout-amount" className="text-xs font-medium">
                Tokens
              </label>
              <Input
                id="payout-amount"
                type="number"
                inputMode="numeric"
                min={minTokens}
                max={summary.available}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`min ${minTokens.toLocaleString("en-US")}, max ${summary.available.toLocaleString("en-US")}`}
                disabled={pending}
              />
              {parsed > 0 && !aboveMin ? (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircleIcon className="size-3" />
                  Below the {minTokens.toLocaleString()}-token minimum.
                </p>
              ) : parsed > summary.available ? (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircleIcon className="size-3" />
                  Exceeds your available balance.
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={
                pending ||
                parsed <= 0 ||
                !aboveMin ||
                !fitsAvailable
              }
              className="shadow-gold"
            >
              {pending ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <ArrowDownToLineIcon className="mr-2 size-4" />
              )}
              Request payout
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent payout requests</CardTitle>
          <CardDescription>
            Newest first. Pending ones you can still cancel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payout requests yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {payouts.map((p) => {
                const meta = STATUS_LABELS[p.status];
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium tabular-nums">
                        {fmt(p.tokens)} tokens
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Requested{" "}
                        {new Date(p.created_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {p.processed_at
                          ? ` · paid ${new Date(p.processed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                          : ""}
                        {p.payment_reference
                          ? ` · ref ${p.payment_reference}`
                          : ""}
                      </p>
                      {p.note ? (
                        <p className="text-xs text-muted-foreground italic">
                          “{p.note}”
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={meta.tone}>
                        {meta.label}
                      </Badge>
                      {p.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCancel(p.id)}
                          disabled={busyId === p.id}
                        >
                          {busyId === p.id ? (
                            <Loader2Icon className="mr-1 size-3 animate-spin" />
                          ) : (
                            <XCircleIcon className="mr-1 size-3" />
                          )}
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator />

      <p className="text-xs text-muted-foreground">
        Commissions come out of the seller&apos;s share at release time. The
        ledger entries below show each transfer.
      </p>
    </div>
  );
}