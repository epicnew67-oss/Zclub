"use client";

import { useEffect, useRef, useState } from "react";
import { CoinsIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Live wallet balance chip.
 *
 * Subscribes to ledger_entries INSERTs for the caller's wallet via
 * Supabase Realtime and recomputes the balance (via the existing
 * `get_own_wallet_balance` RPC) on each new row. The displayed number
 * is the only source of truth shown in the navbar — there is no
 * stored balance column anywhere.
 */
export function BalanceChip({
  walletId,
  initialBalance,
  signedIn,
}: {
  walletId: string | null;
  initialBalance: number;
  signedIn: boolean;
}) {
  const [balance, setBalance] = useState<number>(initialBalance);
  const [pulse, setPulse] = useState<"up" | "down" | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setBalance(initialBalance);
  }, [initialBalance]);

  useEffect(() => {
    if (!walletId || !signedIn) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`wallet-balance:${walletId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ledger_entries",
          filter: `wallet_id=eq.${walletId}`,
        },
        async (payload) => {
          const newAmount = (payload.new as { amount: number }).amount;
          // Recompute the authoritative balance from the RPC rather
          // than applying the delta — if the event drops or arrives
          // out of order, the RPC sum is the source of truth.
          const { data } = await supabase.rpc("get_own_wallet_balance");
          const next = typeof data === "number" ? data : balance;
          setBalance(next);
          if (pulseTimer.current) clearTimeout(pulseTimer.current);
          setPulse(newAmount >= 0 ? "up" : "down");
          pulseTimer.current = setTimeout(() => setPulse(null), 700);
        }
      )
      .subscribe();
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      supabase.removeChannel(channel);
    };
    // We intentionally exclude `balance` from deps — the listener only
    // cares about walletId/signedIn changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId, signedIn]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex h-9 items-center gap-2 rounded-full border border-gold/40 bg-gold/5 px-3.5 text-sm transition-colors",
            pulse === "up" && "border-success/60 bg-success/10",
            pulse === "down" && "border-destructive/60 bg-destructive/10"
          )}
        >
          <CoinsIcon
            className={cn(
              "size-4",
              pulse === "up" && "text-success",
              pulse === "down" && "text-destructive",
              !pulse && "text-gold"
            )}
          />
          <span className="font-medium tabular-nums">
            {balance.toLocaleString("en-US")}
          </span>
          <span className="hidden text-muted-foreground sm:inline">tokens</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Wallet balance — sum of your ledger. Updates live when entries
        are added.
      </TooltipContent>
    </Tooltip>
  );
}