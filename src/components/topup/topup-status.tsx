"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  AlertTriangleIcon,
  XCircleIcon,
  Loader2Icon,
  ExternalLinkIcon,
  ClockIcon,
  CopyIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCryptoCode, type TopupStatusData } from "@/lib/topups/types";
import {
  cancelCryptoTopupAction,
  syncCryptoTopupAction,
} from "@/app/wallet/topup/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type Props = {
  userId: string;
  topup: TopupStatusData["topup"];
  payment: TopupStatusData["payment"];
  pack: TopupStatusData["pack"];
  returnUrl: string;
};

function Countdown({ expiresAt, status }: { expiresAt: string | null; status: string }) {
  const [left, setLeft] = useState(() => {
    if (!expiresAt || status !== "pending") return null;
    return Math.max(0, new Date(expiresAt).getTime() - Date.now());
  });
  useEffect(() => {
    if (!expiresAt || status !== "pending") return;
    const timer = setInterval(() => {
      setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, status]);
  if (left == null) return null;
  if (status !== "pending") return null;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  if (left <= 0) {
    return <span className="text-destructive">Payment window expired — start a new top-up</span>;
  }
  return <span className="tabular-nums text-gold">{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")} left</span>;
}

// NOWPayments statuses → customer-facing copy (the real status returned
// by the API — never a blanket "confirming").
const CRYPTO_STATUS_COPY: Record<string, string> = {
  waiting: "Waiting for payment",
  confirming: "Payment detected — waiting for confirmations…",
  confirmed: "Payment confirmed — finalizing…",
  sending: "Payment confirmed — finalizing…",
  partially_paid: "Underpaid — flagged for manual review",
  finished: "Payment complete",
  failed: "Payment failed",
  refunded: "Refunded — under review",
  expired: "Payment window expired",
  cancelled: "Cancelled",
};

export function TopupStatus({ userId: _userId, topup: initial, payment: initialPayment, pack, returnUrl }: Props) {
  const router = useRouter();
  const [topup, setTopup] = useState(initial);
  const [payment, setPayment] = useState(initialPayment);
  const [successRedirectFired, setSuccessRedirectFired] = useState(topup.status === "completed");
  const [copied, setCopied] = useState<"address" | "amount" | null>(null);
  const [cancelPending, startCancel] = useTransition();

  const isPending = topup.status === "pending";
  const isCrypto = topup.method === "crypto";
  const hasDirectCrypto = isCrypto && Boolean(payment?.pay_address);

  // Live updates: the buyer's own row (RLS own-policy makes this filtered).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`topup-status:${topup.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "topup_requests",
          filter: `id=eq.${topup.id}`,
        },
        (payload) => {
          const next = payload.new as TopupStatusData["topup"];
          setTopup((prev) => ({ ...prev, ...next }));
          if ((next as { status: string }).status === "completed") {
            setSuccessRedirectFired(true);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [topup.id]);

  // Also track the linked payment (address / status / flagged states).
  useEffect(() => {
    if (!payment) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`topup-payment:${payment.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${payment.id}`,
        },
        (payload) => {
          const next = payload.new as TopupStatusData["payment"];
          setPayment(next as TopupStatusData["payment"]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [payment?.id]);

  // Server-side status sync: ask OUR server to re-check NOWPayments and
  // apply the result through the same idempotent credit path as the IPN.
  // The client never supplies or invents a payment status.
  useEffect(() => {
    if (!hasDirectCrypto || topup.status !== "pending") return;
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      const result = await syncCryptoTopupAction(topup.id).catch(() => null);
      if (stopped || !result || "error" in result || !result.payStatus) return;
      setPayment((prev) => (prev ? { ...prev, pay_status: result.payStatus } : prev));
      if (result.status && result.status !== "pending") {
        setTopup((prev) => ({
          ...prev,
          status: result.status as TopupStatusData["topup"]["status"],
        }));
        if (result.status === "completed") setSuccessRedirectFired(true);
      }
    };
    const timer = setInterval(tick, 9000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [hasDirectCrypto, topup.status, topup.id]);

  // On success, auto-redirect to the original return URL (default /wallet).
  useEffect(() => {
    if (topup.status !== "completed" || !successRedirectFired) return;
    const timer = setTimeout(() => {
      window.location.assign(returnUrl);
    }, 1600);
    return () => clearTimeout(timer);
  }, [topup.status, successRedirectFired, returnUrl]);

  const coin = useMemo(() => formatCryptoCode(payment?.pay_currency), [payment?.pay_currency]);

  const cryptoStatusKey =
    topup.status === "completed"
      ? "finished"
      : payment?.pay_status ?? (isCrypto && isPending ? "waiting" : null);
  const cryptoLabel = cryptoStatusKey
    ? CRYPTO_STATUS_COPY[cryptoStatusKey] ?? cryptoStatusKey
    : null;

  const statusBadge = useMemo(() => {
    if (isCrypto && isPending) {
      const map = {
        waiting: { label: "Waiting for payment", variant: "outline" as const, icon: CircleDashedIcon },
        confirming: { label: "Detected — confirming", variant: "default" as const, icon: Loader2Icon },
        confirmed: { label: "Confirmed", variant: "default" as const, icon: Loader2Icon },
        sending: { label: "Finalizing", variant: "default" as const, icon: Loader2Icon },
        partially_paid: { label: "Underpaid — review", variant: "destructive" as const, icon: AlertTriangleIcon },
        refunded: { label: "Refunded — review", variant: "destructive" as const, icon: AlertTriangleIcon },
        expired: { label: "Expired", variant: "destructive" as const, icon: ClockIcon },
      };
      return map[(payment?.pay_status ?? "waiting") as keyof typeof map] ?? map.waiting;
    }
    const map: Record<string, { label: string; variant: "outline" | "success" | "destructive" | "default"; icon: typeof CircleCheckIcon }> = {
      pending: { label: "Awaiting verification", variant: "outline", icon: CircleDashedIcon },
      completed: { label: "Completed", variant: "success", icon: CircleCheckIcon },
      failed: { label: topup.review_note ? "Rejected" : "Failed", variant: "destructive", icon: XCircleIcon },
      expired: { label: "Expired", variant: "destructive", icon: ClockIcon },
    };
    return map[topup.status] ?? map.pending;
  }, [isCrypto, isPending, payment?.pay_status, topup.status, topup.review_note]);

  const StatusIcon = statusBadge.icon;

  const copy = (text: string, what: "address" | "amount") => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        toast.success(what === "address" ? "Address copied" : "Amount copied");
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => toast.error("Couldn't copy — select it manually."));
  };

  const title = topup.status === "completed"
    ? "Payment confirmed"
    : hasDirectCrypto && isPending && cryptoLabel
      ? cryptoLabel
      : isPending
        ? "Awaiting verification"
        : statusBadge.label;

  function handleCancelPayment() {
    startCancel(async () => {
      const result = await cancelCryptoTopupAction(topup.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment cancelled.");
      setTopup((prev) => ({ ...prev, status: "expired" }));
      setPayment((prev) => (prev ? { ...prev, pay_status: "cancelled" } : prev));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card variant={topup.status === "completed" ? "gold" : "default"}>
        <CardHeader>
          <div className="flex items-center gap-2">
            {isPending ? (
              <Loader2Icon className="size-5 animate-spin text-gold" />
            ) : (
              <StatusIcon className={`size-5 ${topup.status === "completed" ? "text-success" : topup.status === "pending" ? "text-gold" : "text-destructive"}`} />
            )}
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {pack
              ? `${pack.label} · ${
                  isCrypto && payment?.price_usd != null
                    ? `$${Number(payment.price_usd).toFixed(2)}`
                    : `PKR ${pack.price_pkr.toLocaleString("en-US")}`
                } → ${topup.tokens.toLocaleString("en-US")} tokens`
              : `${topup.tokens.toLocaleString("en-US")} tokens`}
            <Badge variant={statusBadge.variant}>
              <StatusIcon data-icon="inline-start" />
              {statusBadge.label}
            </Badge>
            {isCrypto && payment?.invoice_url ? (
              <a
                href={payment.invoice_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
              >
                Open invoice <ExternalLinkIcon className="size-3" />
              </a>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasDirectCrypto && payment?.pay_address ? (
            <div className="rounded-xl border border-gold/30 bg-gradient-to-b from-gold/[0.08] via-transparent to-transparent p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                  Pay with <span className="text-gold">{coin.symbol}</span>
                  {coin.network ? (
                    <span className="text-muted-foreground"> · {coin.network}</span>
                  ) : null}
                </div>
                {payment.pay_expires_at && isPending ? (
                  <Countdown expiresAt={payment.pay_expires_at} status={topup.status} />
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-3">
                <span className="font-heading text-4xl font-semibold tabular-nums text-gold">
                  {payment.pay_amount}
                </span>
                <span className="text-sm text-muted-foreground">{coin.symbol}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-gold"
                  onClick={() => copy(String(payment.pay_amount), "amount")}
                >
                  <CopyIcon className="size-3.5" />
                  {copied === "amount" ? "Copied" : "Copy amount"}
                </Button>
              </div>

              <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
                <div
                  aria-label="Payment QR code"
                  className="shrink-0 rounded-xl p-3 shadow-gold"
                  style={{ backgroundColor: "#F3ECE4" }}
                >
                  <QRCodeSVG
                    value={payment.pay_address}
                    size={168}
                    bgColor="#F3ECE4"
                    fgColor="#17100B"
                    level="M"
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-3 text-sm">
                  <div>
                    <div className="text-xs tracking-wider text-muted-foreground uppercase">
                      Send exactly
                    </div>
                    <div className="mt-1 font-medium tabular-nums">
                      {payment.pay_amount} {coin.symbol}
                      {coin.network ? ` (${coin.network})` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs tracking-wider text-muted-foreground uppercase">
                      To this address
                    </div>
                    <div className="mt-1 break-all font-mono text-foreground">
                      {payment.pay_address}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 border-gold/40 text-gold hover:bg-gold/10"
                      onClick={() => copy(payment.pay_address!, "address")}
                    >
                      <CopyIcon className="size-3.5" />
                      {copied === "address" ? "Address copied" : "Copy address"}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                    Send only {coin.symbol}
                    {coin.network ? ` on ${coin.network}` : ""} to this address. Status:{" "}
                    <span className="text-gold">{cryptoLabel ?? "Waiting for payment"}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {topup.status === "pending" && !hasDirectCrypto ? (
            <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-sm">
              We&apos;re watching for your payment. Once it lands, we credit your tokens
              and send you back.
            </div>
          ) : null}

          {payment?.pay_status === "partially_paid" ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              We received less than the exact amount — the payment is flagged for
              manual review and our team will sort it out.
            </p>
          ) : null}

          {topup.expires_at && isPending && topup.method !== "crypto" ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <Countdown expiresAt={topup.expires_at} status={topup.status} />
            </div>
          ) : null}

          {topup.reference_code ? (
            <div className="text-sm">
              <span className="text-xs tracking-wider text-muted-foreground uppercase">Reference code</span>
              <div className="mt-1 font-mono text-gold">{topup.reference_code}</div>
            </div>
          ) : null}

          {topup.status === "completed" ? (
            <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
              +{topup.tokens.toLocaleString("en-US")} tokens added. Redirecting to your chosen page…
            </p>
          ) : null}

          {topup.status === "failed" && topup.review_note ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Rejected: {topup.review_note}
            </p>
          ) : null}
          {topup.status === "expired" ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              This top-up expired without a transfer. Start a new one to try again.
            </p>
          ) : null}

          <Separator />

          <div className="flex flex-wrap gap-2">
            {topup.status === "completed" ? (
              <Button asChild className="shadow-gold">
                <Link href={returnUrl}>Continue</Link>
              </Button>
            ) : null}
            {hasDirectCrypto && isPending ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={cancelPending}
                onClick={handleCancelPayment}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                {cancelPending ? (
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                ) : null}
                Cancel payment
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/wallet">Back to wallet</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {topup.status === "pending" ? (
        <p className="text-center text-xs text-muted-foreground">
          Live updates are active on this page. Keep it open and finish the
          external transfer within the 30-minute window (manual) or send the
          exact crypto amount while the payment window is live.
        </p>
      ) : null}
    </div>
  );
}
