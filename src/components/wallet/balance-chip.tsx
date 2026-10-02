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

  const [previousBalance, setPreviousBalance] = useState(initialBalance);
  if (previousBalance !== initialBalance) {
    setPreviousBalance(initialBalance);
    setBalance(initialBalance);
  }

  useEffect(() => {
    if (!walletId || !signedIn) return;
    const supabase = createClient();
    let active = true;
    const refresh = async () => {
      const { data } = await supabase.rpc("get_own_wallet_balance");
      if (active && typeof data === "number") setBalance(data);
    };
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const channel = supabase
      // The navbar and page header can each render a BalanceChip. Supabase
      // reuses channels with the same topic, so each mounted subscription
      // needs its own topic (including React Strict Mode effect remounts).
      .channel(`wallet-balance:${walletId}:${crypto.randomUUID()}`)
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
          await refresh();
          if (pulseTimer.current) clearTimeout(pulseTimer.current);
          setPulse(newAmount >= 0 ? "up" : "down");
          pulseTimer.current = setTimeout(() => setPulse(null), 700);
        }
      )
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      supabase.removeChannel(channel);
    };
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
