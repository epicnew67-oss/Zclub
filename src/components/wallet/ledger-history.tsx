"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, CoinsIcon, Loader2Icon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export type LedgerRow = {
  id: number;
  entry_type: string;
  amount: number;
  ref_type: string | null;
  ref_id: string | null;
  description: string | null;
  created_at: string;
};

const PAGE_SIZE = 15;

const ENTRY_TYPE_LABELS: Record<string, { label: string; tone: "credit" | "debit" | "neutral" }> = {
  topup: { label: "Tokens added", tone: "credit" },
  bonus: { label: "Bonus", tone: "credit" },
  support_adjustment: { label: "Adjustment", tone: "credit" },
  booking_hold: { label: "Call purchase", tone: "debit" },
  booking_release: { label: "Call earnings", tone: "credit" },
  booking_refund: { label: "Refund", tone: "credit" },
  payout: { label: "Withdrawal", tone: "debit" },
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "topup", label: "Top-ups" },
  { value: "booking_hold", label: "Purchases" },
  { value: "booking_release", label: "Earnings", sellerOnly: true },
  { value: "booking_refund", label: "Refunds" },
  { value: "payout", label: "Withdrawals", sellerOnly: true },
  { value: "bonus", label: "Bonuses" },
  { value: "support_adjustment", label: "Adjustments" },
];

export function LedgerHistory({
  walletId,
  initialRows,
  initialCount,
  isSeller,
}: {
  walletId: string;
  initialRows: LedgerRow[];
  initialCount: number;
  isSeller: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const requestedFilter = searchParams.get("type") ?? "all";
  const filter = FILTERS.some((f) => f.value === requestedFilter && (!f.sellerOnly || isSeller))
    ? requestedFilter
    : "all";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [rows, setRows] = useState<LedgerRow[]>(initialRows);
  const [total, setTotal] = useState<number>(initialCount);
  const [loading, setLoading] = useState(false);

  // Refetch when filter / page changes via URL.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();
      let query = supabase
        .from("ledger_entries")
        .select("*", { count: "exact" })
        .eq("wallet_id", walletId)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (filter !== "all") {
        query = query.eq("entry_type", filter);
      }
      const { data, count } = await query;
      if (cancelled) return;
      setRows((data ?? []) as LedgerRow[]);
      setTotal(count ?? 0);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [filter, page, walletId]);

  // Realtime: new ledger rows for this wallet prepend to the list and
  // update the total. Balance itself is handled in the BalanceChip.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ledger:${walletId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ledger_entries",
          filter: `wallet_id=eq.${walletId}`,
        },
        (payload) => {
          const newRow = payload.new as LedgerRow;
          if (filter !== "all" && newRow.entry_type !== filter) return;
          setTotal((n) => n + 1);
          if (page === 1) {
            setRows((prev) => prev.some((r) => r.id === newRow.id)
              ? prev
              : [newRow, ...prev].slice(0, PAGE_SIZE));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [walletId, filter, page]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "" || value === "all") next.delete(key);
    else next.set(key, value);
    if (key === "type") next.delete("page");
    startTransition(() => {
      router.replace(`/wallet?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Token activity</CardTitle>
            <CardDescription>
              Tokens added, spent, or returned. Newest first.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.filter((f) => !f.sellerOnly || isSeller).map((f) => {
              const active = filter === f.value;
              return (
                <Button
                  key={f.value}
                  type="button"
                  size="xs"
                  variant={active ? "default" : "outline"}
                  onClick={() => updateParam("type", f.value === "all" ? "" : f.value)}
                  aria-pressed={active}
                >
                  {f.label}
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/30 py-12 text-center">
            <CoinsIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {filter === "all"
                ? "No token activity yet."
                : `No entries match the "${FILTERS.find((f) => f.value === filter)?.label}" filter.`}
            </p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 md:hidden">
            {rows.map((row) => {
              const meta = ENTRY_TYPE_LABELS[row.entry_type] ?? { label: row.entry_type, tone: "neutral" as const };
              const positive = row.amount > 0;
              return (
                <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{meta.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground"><LocalDateTime value={row.created_at} /></p>
                  </div>
                  <span className={`shrink-0 font-semibold tabular-nums ${positive ? "text-success" : "text-destructive"}`}>
                    {positive ? "+" : ""}{row.amount.toLocaleString("en-US")} <span className="text-xs font-normal">tokens</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-hidden rounded-lg border border-border/70 md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs tracking-wider text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Activity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => {
                  const meta = ENTRY_TYPE_LABELS[row.entry_type] ?? {
                    label: row.entry_type,
                    tone: "neutral" as const,
                  };
                  const positive = row.amount > 0;
                  return (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 align-middle text-foreground">
                        <LocalDateTime value={row.created_at} />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <Badge
                          variant={
                            meta.tone === "credit"
                              ? "success"
                              : meta.tone === "debit"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {positive ? (
                            <ArrowDownIcon data-icon="inline-start" />
                          ) : (
                            <ArrowUpIcon data-icon="inline-start" />
                          )}
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right align-middle font-medium tabular-nums">
                        <span className={positive ? "text-success" : "text-destructive"}>
                          {positive ? "+" : ""}
                          {row.amount.toLocaleString("en-US")}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          tokens
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {total > PAGE_SIZE ? (
          <>
            <Separator />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} · {total.toLocaleString("en-US")} entries
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => updateParam("page", String(page - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || loading}
                  onClick={() => updateParam("page", String(page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" /> Refreshing ledger…
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
