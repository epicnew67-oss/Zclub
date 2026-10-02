"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useNotifications, type NotificationRow } from "@/hooks/use-notifications";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/notifications/actions";
import Button38 from "@/components/watermelon/button-38";

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
  const firstOpenRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    if (firstOpenRef.current) {
      firstOpenRef.current = false;
    }
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

  // First time the bell opens, ask for push permission (best-effort).
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    void maybeAutoSubscribe();
  }, [open]);



  return (
    <div ref={rootRef} className="relative">
      {/* watermelon button-38 as the notifications trigger; clicks bubble
          from its <button> so the dropdown behaviour is unchanged. */}
      <div onClick={() => setOpen((v) => !v)}>
        <Button38 />
      </div>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border/70 bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="text-sm font-medium">Notifications</div>
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
          <ul className="max-h-96 overflow-y-auto">
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
          <div className="px-4 py-2 text-center">
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link href="/notifications">View all</Link>
            </Button>
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
      className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left text-sm transition-colors hover:bg-elevated/60 disabled:opacity-40 ${
        isUnread ? "bg-burgundy/5" : ""
      }`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className={`truncate font-medium ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
          {row.title}
        </span>
        {isUnread ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
        ) : null}
      </div>
      {row.body ? <div className="line-clamp-2 text-xs text-muted-foreground">{row.body}</div> : null}
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {relativeTime(row.created_at)}
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
