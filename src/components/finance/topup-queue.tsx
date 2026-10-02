"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { financeApproveTopupAction, financeRejectTopupAction } from "@/app/finance/topups/actions";
import type { FinanceQueueItem } from "@/lib/topups/types";

type Props = { initialItems: FinanceQueueItem[] };

function ExpiredBadge({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = requestAnimationFrame(tick);
    const timer = setInterval(tick, 1000);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); };
  }, []);
  if (!expiresAt || now === null) return null;
  const expired = new Date(expiresAt).getTime() < now;
  if (!expired) return null;
  return <Badge variant="destructive">Expired window</Badge>;
}

export function FinanceTopupQueue({ initialItems }: Props) {
  const items = initialItems;
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const router = useRouter();


  // Deep link from admin notifications: /finance/topups?id=<topupId>
  // scrolls to that card and rings it briefly so the notification lands
  // on the exact request.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    const scrollTimer = setTimeout(() => {
      setHighlightId(id);
      document
        .getElementById(`topup-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = setTimeout(() => setHighlightId(null), 5000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, []);

  // Keep the queue fresh without relying on realtime (RLS own-only doesn't
  // broadcast others' top-ups to finance viewers).
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);

  const manualOnly = useMemo(
    () => items.filter((i) => i.method !== "crypto" || i.payment_needs_review),
    [items]
  );

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    toast.success("Copied");
  };

  async function handleApprove(id: string) {
    setBusy(id);
    const result = await financeApproveTopupAction(id, noteById[id] ?? null);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Top-up approved — ledger credited once, audit logged.");
      router.refresh();
    }
    setBusy(null);
  }

  async function handleReject(id: string) {
    const reason = (reasonById[id] ?? "").trim();
    if (!reason) {
      toast.error("Enter a reason before rejecting.");
      return;
    }
    setBusy(id);
    const result = await financeRejectTopupAction(id, reason);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Top-up rejected.");
      router.refresh();
    }
    setBusy(null);
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All clear</CardTitle>
          <CardDescription>No pending top-ups awaiting review.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.some((i) => i.payment_needs_review) ? (
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
          <AlertTriangleIcon data-icon="inline-start" className="inline size-4" /> Flagged
          crypto payments need manual review (underpaid/overpaid/refunded) — treat them as
          pending until you approve or reject.
        </div>
      ) : null}
      {manualOnly.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {manualOnly.length === items.length
            ? `${items.length} manual top-up${items.length === 1 ? "" : "s"} in the queue.`
            : `${manualOnly.length} manual (+ ${items.length - manualOnly.length} flagged crypto) — showing ${items.length} pending total.`}
        </p>
      ) : null}

      <div className="grid gap-4">
        {items.map((item) => (
          <Card
            key={item.id}
            id={`topup-${item.id}`}
            className={[
              item.payment_needs_review ? "border-gold/40" : "",
              highlightId === item.id ? "ring-2 ring-gold/70" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined}
          >
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {item.tokens.toLocaleString("en-US")} tokens ·{" "}
                  {item.price_pkr != null ? `PKR ${item.price_pkr.toLocaleString("en-US")}` : `${item.tokens.toLocaleString("en-US")} tokens`}
                </CardTitle>
                <Badge variant="outline" className="capitalize">
                  {item.method}
                </Badge>
                <ExpiredBadge expiresAt={item.expires_at} />
                {item.payment_needs_review ? (
                  <Badge className="bg-gold text-background">{item.payment_flag_reason ?? "Flagged"}</Badge>
                ) : null}
              </div>
              <CardDescription>
                {item.buyer_name ?? "Unknown"} {item.buyer_email ? `· ${item.buyer_email}` : ""} ·{" "}
                {new Date(item.created_at).toLocaleString("en-US")}
                {item.expires_at && item.method !== "crypto" ? ` · window to ${new Date(item.expires_at).toLocaleString("en-US")}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {item.reference_code ? (
                  <div>
                    <dt className="text-xs tracking-wider text-muted-foreground uppercase">Reference</dt>
                    <dd className="mt-1 font-mono text-gold">{item.reference_code}</dd>
                  </div>
                ) : null}
                {item.transaction_id ? (
                  <div>
                    <dt className="text-xs tracking-wider text-muted-foreground uppercase">Transaction ID</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono text-foreground">
                      {item.transaction_id}{" "}
                      <button type="button" className="text-gold hover:underline" onClick={() => copy(item.transaction_id!)}>
                        <CopyIcon className="size-3" />
                      </button>
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-xs tracking-wider text-muted-foreground uppercase">Transaction ID</dt>
                    <dd className="mt-1 text-muted-foreground">Awaiting buyer submission</dd>
                  </div>
                )}
                {item.sender_number ? (
                  <div>
                    <dt className="text-xs tracking-wider text-muted-foreground uppercase">Sender</dt>
                    <dd className="mt-1 font-mono text-foreground">{item.sender_number}</dd>
                  </div>
                ) : null}
                {item.payment_external_id ? (
                  <div>
                    <dt className="text-xs tracking-wider text-muted-foreground uppercase">Payment ID</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono text-xs text-foreground">
                      {item.payment_external_id}{" "}
                      <button type="button" className="text-gold hover:underline" onClick={() => copy(item.payment_external_id!)}>
                        <CopyIcon className="size-3" />
                      </button>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {item.screenshot_url ? (
                <div>
                  <div className="text-xs tracking-wider text-muted-foreground uppercase">Screenshot</div>
                  <a
                    href={item.screenshot_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-gold hover:underline"
                  >
                    Open <ExternalLinkIcon className="size-3" />
                  </a>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.screenshot_url}
                    alt="Payment screenshot"
                    className="mt-2 max-h-72 rounded-lg border border-border/70 object-contain"
                  />
                </div>
              ) : item.screenshot_path ? (
                <p className="text-xs text-muted-foreground">Screenshot path: {item.screenshot_path} (signed URL unavailable).</p>
              ) : null}

              {item.payment_actually_paid != null && String(item.payment_actually_paid) !== "0" ? (
                <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-gold">
                  Received {item.payment_actually_paid} vs expected {item.payment_pay_amount ?? "?"} ({item.payment_flag_reason ?? "check amount"})
                </p>
              ) : null}

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`note-${item.id}`}>Approve note (optional)</Label>
                  <Input
                    id={`note-${item.id}`}
                    placeholder="credited ok, etc."
                    value={noteById[item.id] ?? ""}
                    onChange={(e) => setNoteById((m) => ({ ...m, [item.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    className="shadow-gold"
                    onClick={() => handleApprove(item.id)}
                    disabled={busy === item.id}
                  >
                    {busy === item.id ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckIcon data-icon="inline-start" />}
                    Approve & credit once
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`reason-${item.id}`}>Reject reason *</Label>
                  <Textarea
                    id={`reason-${item.id}`}
                    placeholder="e.g. fake screenshot — not matching transaction ID"
                    value={reasonById[item.id] ?? ""}
                    onChange={(e) => setReasonById((m) => ({ ...m, [item.id]: e.target.value }))}
                    rows={2}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleReject(item.id)}
                    disabled={busy === item.id}
                  >
                    {busy === item.id ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <XIcon data-icon="inline-start" />}
                    Reject
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Approving writes one ledger entry (idempotent by top-up), marks the
        top-up completed, and appends an audit row — single transaction.
        Re-approving an already-processed top-up is refused.
      </p>
    </div>
  );
}
