"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Keep the seller's slot and call status current while the dashboard is open. */
export function SellerBookingRefresh({ userId }: { userId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const refresh = () => { if (active) router.refresh(); };
    const channel = supabase.channel(`seller-bookings:${userId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, payload => {
        if ((payload.new as { type?: string }).type === "booking") refresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings", filter: `seller_id=eq.${userId}` }, refresh)
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    // A missed websocket event must not leave a booked/running call stale.
    const poll = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);
  return <span hidden data-testid="seller-booking-realtime" data-connected={connected} />;
}
