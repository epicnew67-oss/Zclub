"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  AlertTriangleIcon,
  XCircleIcon,
  Loader2Icon,
  ExternalLinkIcon,
  ClockIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { TopupStatusData } from "@/lib/topups/types";
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

export function TopupStatus({ userId: _userId, topup: initial, payment: initialPayment, pack, returnUrl }: Props) {
  const [topup, setTopup] = useState(initial);
  const [payment, setPayment] = useState(initialPayment);
  const [successRedirectFired, setSuccessRedirectFired] = useState(topup.status === "completed");

  const isPending = topup.status === "pending";
  const isCrypto = topup.method === "crypto";

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

  // Also track the linked payment (rate / address updates, flagged states).
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

  // On success, auto-redirect to the original return URL (default /wallet).
  useEffect(() => {
    if (topup.status !== "completed" || !successRedirectFired) return;
    const timer = setTimeout(() => {
      window.location.assign(returnUrl);
    }, 1600);
    return () => clearTimeout(timer);
  }, [topup.status, successRedirectFired, returnUrl]);

  const statusBadge = useMemo(() => {
    const map: Record<string, { label: string; variant: "outline" | "success" | "destructive" | "default"; icon: typeof CircleCheckIcon }> = {
      pending: { label: "Payment confirming", variant: "outline", icon: CircleDashedIcon },
      completed: { label: "Completed", variant: "success", icon: CircleCheckIcon },
      failed: { label: topup.review_note ? "Rejected" : "Failed", variant: "destructive", icon: XCircleIcon },
      expired: { label: "Expired", variant: "destructive", icon: ClockIcon },
    };
    const entry = map[topup.status] ?? map.pending;
    return entry;
  }, [topup.status]);

  const StatusIcon = statusBadge.icon;

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
            <CardTitle>{isPending ? "Payment confirming" : topup.status === "completed" ? "Payment confirmed" : statusBadge.label}</CardTitle>
          </div>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {pack ? `${pack.label} · PKR ${pack.price_pkr.toLocaleString("en-US")} → ${topup.tokens.toLocaleString("en-US")} tokens` : `${topup.tokens.toLocaleString("en-US")} tokens`}
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
          {topup.status === "pending" ? (
            <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-sm">
              We&apos;re watching for your payment. This page updates live — once it
              lands, we credit your tokens and send you back.
            </div>
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

          {payment?.pay_address ? (
            <div className="space-y-1 text-sm">
              <div className="text-xs tracking-wider text-muted-foreground uppercase">Pay to address</div>
              <div className="break-all font-mono text-foreground">{payment.pay_address}</div>
              {payment.pay_amount ? (
                <div className="text-xs text-muted-foreground">
                  Amount: {Number(payment.pay_amount).toString()} {payment.pay_currency ?? "crypto"} · PKR {payment.price_pkr.toLocaleString("en-US")}
                </div>
              ) : null}
            </div>
          ) : null}

          {topup.status === "completed" ? (
            <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
              Credited {topup.tokens.toLocaleString("en-US")} tokens. Redirecting to your chosen page…
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
            <Button asChild variant="ghost">
              <Link href="/wallet">Back to wallet</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {topup.status === "pending" ? (
        <p className="text-center text-xs text-muted-foreground">
          Live updates are active on this page. Keep it open and finish the
          external transfer within the 30-minute window (manual) or let the
          crypto invoice auto-confirm.
        </p>
      ) : null}
    </div>
  );
}
