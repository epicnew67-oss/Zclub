"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Presence expires on the server after 90 seconds without a heartbeat. */
export function SellerPresence() {
  useEffect(() => {
    const supabase = createClient();
    const heartbeat = () => {
      if (document.visibilityState === "visible") void supabase.rpc("seller_heartbeat");
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 25_000);
    document.addEventListener("visibilitychange", heartbeat);
    window.addEventListener("focus", heartbeat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
      window.removeEventListener("focus", heartbeat);
    };
  }, []);
  return null;
}
