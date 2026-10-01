"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  CopyIcon,
  Loader2Icon,
  WalletIcon,
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
import { Textarea } from "@/components/ui/textarea";
import {
  approvePayoutAction,
  markPayoutPaidAction,
  rejectPayoutAction,
} from "@/app/finance/payouts/actions";
import type { PayoutRow } from "@/lib/post-call-money";

type Props = { initialItems: PayoutRow[] };

const STATUS_VARIANT: Record<
  PayoutRow["status"],
  React.ComponentProps<typeof Badge>["variant"]
> = {
  pending: "gold-outline",
  approved: "gold-outline",
  paid: "default",
  rejected: "destructive",
  cancelled: "outline",
};

export function FinancePayoutsQueue({ initialItems }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<PayoutRow[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [refById, setRefById] = useState<Record<string, string>>({});

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Keep fresh without relying on RLS-bypassed Realtime.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [router]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    toast.success("Copied");
  };

  async function handleApprove(id: string) {
    setBusyId(id);
    const res = await approvePayoutAction(id);
    setBusyId(null);
    if (res.ok) {
      toast.success("Approved. Seller will be notified once you mark paid.");
      router.refresh();
    } else {
      toast.error(`Could not approve: ${res.code}`);
    }
  }

  async function handleReject(id: string) {
    const note = (reasonById[id] ?? "").trim();
    if (note.length < 5) {
      toast.error("Reason must be at least 5 characters.");
      return;
    }
    setBusyId(id);
    const res = await rejectPayoutAction(id, note);
    setBusyId(null);
    if (res.ok) {
      toast.success("Rejected.");
      setReasonById((m) => ({ ...m, [id]: "" }));
      router.refresh();
    } else {
      toast.error(`Could not reject: ${res.code}`);
    }
  }

  async function handleMarkPaid(id: string) {
    const ref = (refById[id] ?? "").trim();
    if (ref.length < 1) {
      toast.error("Paste the bank / wallet reference you received.");
      return;
    }
    setBusyId(id);
    const res = await markPayoutPaidAction(id, ref);
    setBusyId(null);
    if (res.ok) {
      toast.success("Marked paid. Seller ledger debited, audit logged.");
      setRefById((m) => ({ ...m, [id]: "" }));
      router.refresh();
    } else {
      toast.error(`Could not mark paid: ${res.code}`);
    }
  }

  const pending = items.filter((i) => i.status === "pending");
  const approved = items.filter((i) => i.status === "approved");
  const paid = items.filter((i) => i.status === "paid").slice(0, 10);
  const rejected = items.filter((i) => i.status === "rejected").slice(0, 5);

  function renderItem(item: PayoutRow, kind: "pending" | "approved") {
    const isBusy = busyId === item.id;
    return (
      <Card key={item.id}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <WalletIcon className="size-4 text-gold" />
              {item.tokens.toLocaleString()} tokens
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(item.id)}
                aria-label="Copy payout id"
              >
                <CopyIcon className="size-3.5" />
                {item.id.slice(0, 8)}
              </Button>
            </div>
          </div>
          <CardDescription>
            Seller {item.seller_id.slice(0, 8)} · requested{" "}
            {new Date(item.created_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {item.note ? (
            <p className="text-xs text-muted-foreground italic">“{item.note}”</p>
          ) : null}
          {item.payment_reference ? (
            <p className="text-xs">
              <span className="text-muted-foreground">Reference: </span>
              <span className="font-medium">{item.payment_reference}</span>
            </p>
          ) : null}

          {kind === "pending" ? (
            <>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleApprove(item.id)}
                  disabled={isBusy}
                  className="shadow-gold"
                >
                  {isBusy ? (
                    <Loader2Icon className="mr-1 size-3 animate-spin" />
                  ) : (
                    <CheckCircle2Icon className="mr-1 size-3" />
                  )}
                  Approve
                </Button>
                <div className="flex flex-1 items-center gap-2 sm:max-w-sm">
                  <Textarea
                    rows={1}
                    placeholder="Reason (≥5 chars) — required to reject"
                    value={reasonById[item.id] ?? ""}
                    onChange={(e) =>
                      setReasonById((m) => ({ ...m, [item.id]: e.target.value }))
                    }
                    disabled={isBusy}
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleReject(item.id)}
                    disabled={isBusy}
                  >
                    {isBusy ? (
                      <Loader2Icon className="size-3 animate-spin" />
                    ) : (
                      <XCircleIcon className="size-3" />
                    )}
                    Reject
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-1 items-center gap-2 sm:max-w-md">
                  <Input
                    placeholder="Paste the transfer reference (JazzCash txn, bank slip, etc.)"
                    value={refById[item.id] ?? ""}
                    onChange={(e) =>
                      setRefById((m) => ({ ...m, [item.id]: e.target.value }))
                    }
                    disabled={isBusy}
                  />
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleMarkPaid(item.id)}
                  disabled={isBusy}
                  className="shadow-gold"
                >
                  {isBusy ? (
                    <Loader2Icon className="mr-1 size-3 animate-spin" />
                  ) : (
                    <CheckCircle2Icon className="mr-1 size-3" />
                  )}
                  Mark paid
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-xl font-semibold">
          Pending <span className="text-gold">({pending.length})</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Approve to move to "approved" (awaiting payment) or reject with a
          reason.
        </p>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No pending requests.
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            {pending.map((p) => renderItem(p, "pending"))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-heading text-xl font-semibold">
          Approved · awaiting payment{" "}
          <span className="text-gold">({approved.length})</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Paste the transfer reference and mark paid. The seller's ledger
          is debited exactly once (idempotent).
        </p>
        {approved.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No approved requests awaiting payment.
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            {approved.map((p) => renderItem(p, "approved"))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-heading text-xl font-semibold">
          Recently paid <span className="text-gold">({paid.length})</span>
        </h2>
        {paid.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/40">
            {paid.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div>
                  <p className="font-medium tabular-nums">
                    {p.tokens.toLocaleString()} tokens
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Paid{" "}
                    {p.processed_at
                      ? new Date(p.processed_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}{" "}
                    · ref {p.payment_reference ?? "—"}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[p.status]}>paid</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 ? (
        <section>
          <h2 className="font-heading text-xl font-semibold">Recently rejected</h2>
          <ul className="mt-4 divide-y divide-border/40">
            {rejected.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div>
                  <p className="font-medium tabular-nums">
                    {p.tokens.toLocaleString()} tokens
                  </p>
                  <p className="text-xs text-muted-foreground italic">
                    “{p.note ?? "no reason”"}”
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[p.status]}>rejected</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}