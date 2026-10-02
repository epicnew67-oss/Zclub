"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BellIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useNotifications, type NotificationRow } from "@/hooks/use-notifications";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/notifications/actions";

export function NotificationBell({
  initialRows,
  initialUnread,
}: {
  initialRows: NotificationRow[];
  initialUnread: number;
}) {
  const { rows, unread, markLocalRead, markAllLocalRead } = useNotifications(initialRows, initialUnread);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(ev: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(ev.target as Node)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} aria-controls="notifications-popover" onClick={() => setOpen((v) => !v)} className="relative grid size-10 place-items-center rounded-lg border border-gold/25 text-foreground hover:border-gold/50 hover:bg-gold/10">
        <BellIcon className="size-[18px]" />
        {unread > 0 ? <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-burgundy px-1 text-[10px] font-bold text-white" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div
          id="notifications-popover"
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-2 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-hidden rounded-xl border border-gold/25 bg-surface shadow-2xl md:absolute md:inset-x-auto md:top-auto md:right-0 md:mt-2 md:w-96"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div><div className="text-sm font-semibold">Notifications</div><p className="text-xs text-muted-foreground">{unread === 0 ? "All caught up" : `${unread} unread`}</p></div>
            {unread > 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await markAllNotificationsReadAction();
                    if (r.ok) markAllLocalRead();
                  })
                }
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {pending ? (
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckIcon className="h-3 w-3" />
                )}
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-[min(65dvh,28rem)] overflow-y-auto">
            {rows.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet.</li>
            ) : null}
            {rows.map((r) => (
              <li key={r.id}>
                <NotificationItem
                  row={r}
                  pending={pending}
                  onMarkRead={() =>
                    startTransition(async () => {
                      if (!r.read_at) {
                        const res = await markNotificationReadAction(r.id);
                        if (res.ok) markLocalRead(r.id);
                      }
                      if (r.link) {
                        setOpen(false);
                        window.location.href = r.link;
                      }
                    })
                  }
                />
              </li>
            ))}
          </ul>
          <Separator />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => void maybeAutoSubscribe()}>Enable phone alerts</Button>
            <Button asChild variant="ghost" size="sm" className="text-xs text-gold"><Link href="/notifications" onClick={() => setOpen(false)}>View all</Link></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationItem({
  row,
  onMarkRead,
  pending,
}: {
  row: NotificationRow;
  onMarkRead: () => void;
  pending: boolean;
}) {
  const isUnread = !row.read_at;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onMarkRead}
      className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-elevated/60 disabled:opacity-40 ${
        isUnread ? "bg-gold/10" : ""
      }`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className={`font-medium leading-snug ${isUnread ? "text-foreground" : "text-foreground/75"}`}>
          {row.title}
        </span>
        {isUnread ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
        ) : null}
      </div>
      {row.body ? <div className="text-xs leading-relaxed text-foreground/70">{row.body}</div> : null}
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {row.type} · {relativeTime(row.created_at)}
      </div>
    </button>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

  async function maybeAutoSubscribe() {
    try {
      const res = await fetch("/api/push/public-key");
      if (!res.ok) return;
      const { publicKey } = await res.json();
      if (!publicKey) return;
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const p256dh = sub.getKey("p256dh");
      const auth = sub.getKey("auth");
      if (!p256dh || !auth) return;
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh: arrayBufferToBase64(p256dh), auth: arrayBufferToBase64(auth) },
          userAgent: navigator.userAgent,
        }),
      });
    } catch {
      /* ignore — best-effort */
    }
  }
