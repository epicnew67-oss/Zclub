"use client";

import { useState, useTransition } from "react";
import {
  setSellerVerifiedAction,
  setSellerActiveAction,
  softDeleteSellerAction,
} from "@/app/admin/sellers/actions";
import type { AdminSellerRow } from "@/lib/admin";

function fmt(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toISOString().slice(0, 10);
}

export function AdminSellerList({ sellers }: { sellers: AdminSellerRow[] }) {
  if (sellers.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-surface/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No approved sellers yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-surface/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Seller</th>
            <th className="px-3 py-2">Verified</th>
            <th className="px-3 py-2">Active</th>
            <th className="px-3 py-2">Joined</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sellers.map((s) => (
            <SellerRow key={s.user_id} seller={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SellerRow({ seller }: { seller: AdminSellerRow }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showSuspend, setShowSuspend] = useState(false);
  const [refundStrategy, setRefundStrategy] = useState<"finish" | "refund_in_progress">("finish");

  const run = (fn: () => Promise<{ ok: boolean; code?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.code ?? "error");
      else setShowSuspend(false);
    });
  };

  return (
    <tr className="border-b border-border/40 align-top last:border-0">
      <td className="px-3 py-2">
        <div className="font-medium">{seller.display_name}</div>
        <div className="font-mono text-xs text-muted-foreground">/{seller.slug}</div>
        <div className="font-mono text-xs text-muted-foreground">{seller.user_id.slice(0, 8)}…</div>
      </td>
      <td className="px-3 py-2">
        {seller.is_verified ? (
          <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-xs text-gold">
            Verified
          </span>
        ) : (
          <span className="rounded border border-border/60 px-1.5 py-0.5 text-xs text-muted-foreground">
            Unverified
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {seller.is_active ? (
          <span className="rounded border border-border/60 px-1.5 py-0.5 text-xs">Active</span>
        ) : (
          <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
            Suspended
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{fmt(seller.created_at)}</td>
      <td className="px-3 py-2 text-right text-xs">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setSellerVerifiedAction(seller.user_id, !seller.is_verified))}
            className="rounded border border-border/60 px-2 py-1 hover:border-gold/40 disabled:opacity-40"
          >
            {seller.is_verified ? "Unverify" : "Verify"}
          </button>
          {seller.is_active ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setShowSuspend(true)}
              className="rounded border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => setSellerActiveAction(seller.user_id, true, "finish"))}
              className="rounded border border-border/60 px-2 py-1 hover:border-gold/40 disabled:opacity-40"
            >
              Reactivate
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm("Soft-delete this seller? Blocked when escrow or payouts are pending.")) {
                run(() => softDeleteSellerAction(seller.user_id));
              }
            }}
            className="rounded border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            Soft delete
          </button>
        </div>
        {showSuspend ? (
          <div className="mt-2 rounded border border-border/60 bg-background/40 p-2 text-left">
            <div className="mb-2">Refund strategy for in-flight bookings?</div>
            <label className="mr-3 text-xs">
              <input
                type="radio"
                name="strategy"
                value="finish"
                checked={refundStrategy === "finish"}
                onChange={() => setRefundStrategy("finish")}
              />{" "}
              Block until in-flight calls complete
            </label>
            <label className="text-xs">
              <input
                type="radio"
                name="strategy"
                value="refund_in_progress"
                checked={refundStrategy === "refund_in_progress"}
                onChange={() => setRefundStrategy("refund_in_progress")}
              />{" "}
              Suspend + flag for support refund
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(() => setSellerActiveAction(seller.user_id, false, refundStrategy))
                }
                className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive hover:bg-destructive/20 disabled:opacity-40"
              >
                Confirm suspend
              </button>
              <button
                type="button"
                onClick={() => setShowSuspend(false)}
                className="rounded border border-border/60 px-2 py-1 hover:border-gold/40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="mt-2 text-xs text-destructive">{error}</div>
        ) : null}
      </td>
    </tr>
  );
}