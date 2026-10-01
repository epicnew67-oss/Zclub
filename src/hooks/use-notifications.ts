"use client";

import { useEffect, useState, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Shape of a notification row — mirrors `notifications` table. Defined
 * here (client-safe) and also re-exported from `@/lib/notifications`
 * (server-only). Importing the type from this file keeps client
 * components free of the server-only import chain.
 */
export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Subscribes to realtime `notifications` rows for the current user and
 * keeps a local copy + unread count. Server actions refresh this via
 * `router.refresh()` after a mark-read; the realtime channel keeps it
 * fresh in background tabs.
 */
export function useNotifications(initialRows: NotificationRow[], initialUnread: number) {
  const [rows, setRows] = useState<NotificationRow[]>(initialRows);
  const [unread, setUnread] = useState<number>(initialUnread);

  useEffect(() => {
    setRows(initialRows);
    setUnread(initialUnread);
  }, [initialRows, initialUnread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    let active = true;
    const channel = supabase
      .channel("notifications-self")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          if (!active) return;
          const row = payload.new as NotificationRow;
          setRows((prev) => [row, ...prev].slice(0, 30));
          setUnread((u) => u + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications" },
        (payload) => {
          if (!active) return;
          const row = payload.new as NotificationRow;
          setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
          if (row.read_at) setUnread((u) => Math.max(0, u - 1));
        }
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const markLocalRead = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id && !r.read_at ? { ...r, read_at: new Date().toISOString() } : r))
    );
    setUnread((u) => Math.max(0, u - 1));
  }, []);

  const markAllLocalRead = useCallback(() => {
    const now = new Date().toISOString();
    setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: now })));
    setUnread(0);
  }, []);

  return { rows, unread, markLocalRead, markAllLocalRead };
}
