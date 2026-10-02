"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyNotification, type NotificationRow, type NotificationState } from "@/lib/notification-state";
export type { NotificationRow } from "@/lib/notification-state";

export function useNotifications(initialRows: NotificationRow[], initialUnread: number) {
  const [state, setState] = useState<NotificationState>({ rows: initialRows, unread: initialUnread });
  const [previous, setPrevious] = useState({ rows: initialRows, unread: initialUnread });
  if (previous.rows !== initialRows || previous.unread !== initialUnread) {
    setPrevious({ rows: initialRows, unread: initialUnread });
    setState({ rows: initialRows, unread: initialUnread });
  }

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    // Recover missed events and the authoritative count on reconnect/focus.
    async function refresh() {
      const [rows, count] = await Promise.all([
        supabase.from("notifications").select("id,type,title,body,link,read_at,created_at").order("created_at", { ascending: false }).limit(30),
        supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
      ]);
      if (active && !rows.error && !count.error) setState({ rows: rows.data ?? [], unread: count.count ?? 0 });
    }
    const channel = supabase.channel(`notifications-self:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, payload => {
        if (active) setState(prev => applyNotification(prev, payload.new as NotificationRow, true));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" }, payload => {
        if (active) setState(prev => applyNotification(prev, payload.new as NotificationRow));
        void refresh();
      })
      .subscribe(status => { if (status === "SUBSCRIBED") void refresh(); });
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); void supabase.removeChannel(channel); };
  }, []);

  const markLocalRead = useCallback((id: string) => {
    const readAt = new Date().toISOString();
    setState(prev => {
      const row = prev.rows.find(r => r.id === id);
      return row && !row.read_at ? applyNotification(prev, { ...row, read_at: readAt }) : prev;
    });
  }, []);
  const markAllLocalRead = useCallback(() => {
    const readAt = new Date().toISOString();
    setState(prev => ({ rows: prev.rows.map(r => r.read_at ? r : { ...r, read_at: readAt }), unread: 0 }));
  }, []);
  return { ...state, markLocalRead, markAllLocalRead };
}
