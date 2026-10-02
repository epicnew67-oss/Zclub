"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, CheckIcon, Loader2Icon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";
import { useNotifications, type NotificationRow } from "@/hooks/use-notifications";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/notifications/actions";
import { LocalDateTime } from "@/components/local-date-time";
import { safeRedirectPath } from "@/lib/safe-redirect";

const SOUND_KEY = "zclub-booking-sound";
const ACK_KEY = "zclub-booking-alert-ack";
const isBooking = (row: NotificationRow) => row.type === "booking" || row.type === "booking_created";

export function NotificationBell({ initialRows, initialUnread, isSeller = false }: {
  initialRows: NotificationRow[]; initialUnread: number; isSeller?: boolean;
}) {
  const { rows, unread, markLocalRead, markAllLocalRead } = useNotifications(initialRows, initialUnread);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [soundEnabled, setSoundEnabled] = useState(() => typeof window === "undefined" || localStorage.getItem(SOUND_KEY) !== "off");
  const [acknowledged, setAcknowledged] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(sessionStorage.getItem(ACK_KEY) ?? "[]"); } catch { return []; }
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isSeller) return;
    // Browsers allow sound after a user gesture. Keep this tab ready for alerts.
    const unlock = () => {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume().catch(() => {});
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      if (audioRef.current) void audioRef.current.close().catch(() => {});
      audioRef.current = null;
    };
  }, [isSeller]);

  const pendingBookings = useMemo(
    () => rows.filter((row) => isBooking(row) && !row.read_at && !acknowledged.includes(row.id)),
    [rows, acknowledged]
  );
  useEffect(() => {
    if (!isSeller || pathname !== "/notifications") return;
    const ids = rows.filter((row) => isBooking(row) && !row.read_at).map((row) => row.id);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => setAcknowledged((previous) => {
      const next = [...new Set([...previous, ...ids])].slice(-100);
      if (next.length === previous.length) return previous;
      sessionStorage.setItem(ACK_KEY, JSON.stringify(next));
      return next;
    }), 0);
    return () => window.clearTimeout(timer);
  }, [isSeller, pathname, rows]);
  useEffect(() => {
    if (!isSeller || !soundEnabled || open || pathname === "/notifications" || pendingBookings.length === 0) return;
    const chime = async () => {
      try {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.state !== "running") await audio.resume();
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        tone.type = "sine";
        tone.frequency.setValueAtTime(740, audio.currentTime);
        tone.frequency.setValueAtTime(988, audio.currentTime + 0.16);
        volume.gain.setValueAtTime(0.0001, audio.currentTime);
        volume.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.34);
        tone.connect(volume).connect(audio.destination);
        tone.start();
        tone.stop(audio.currentTime + 0.35);
      } catch { /* Browser audio is unavailable until a gesture. */ }
    };
    void chime();
    const timer = window.setInterval(() => void chime(), 5000);
    return () => window.clearInterval(timer);
  }, [isSeller, soundEnabled, open, pathname, pendingBookings.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  function togglePanel() {
    if (!open && isSeller) {
      const ids = rows.filter((row) => isBooking(row) && !row.read_at).map((row) => row.id);
      setAcknowledged((previous) => {
        const next = [...new Set([...previous, ...ids])].slice(-100);
        sessionStorage.setItem(ACK_KEY, JSON.stringify(next));
        return next;
      });
    }
    setOpen(!open);
  }
  function toggleSound() {
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
    if (enabled) {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume().catch(() => {});
    }
  }
  function markRead(row: NotificationRow, navigate = false) {
    startTransition(async () => {
      if (!row.read_at) {
        const result = await markNotificationReadAction(row.id);
        if (result.ok) markLocalRead(row.id);
      }
      if (navigate && row.link) { setOpen(false); window.location.assign(safeRedirectPath(row.link, "/notifications")); }
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} aria-controls="notifications-popover" onClick={togglePanel} className="relative grid size-10 place-items-center rounded-lg border border-gold/25 text-foreground hover:border-gold/50 hover:bg-gold/10">
        <BellIcon className="size-[18px]" />
        {unread > 0 ? <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-burgundy px-1 text-[10px] font-bold text-white" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div id="notifications-popover" role="dialog" aria-label="Notifications" className="fixed inset-x-2 top-16 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl md:absolute md:inset-x-auto md:top-auto md:right-0 md:mt-2 md:w-[28rem]">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div><h2 className="text-base font-semibold text-foreground">Notifications</h2><p className="mt-0.5 text-sm text-muted-foreground">{unread ? `${unread} unread` : "All caught up"}</p></div>
            <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="rounded p-1.5 text-muted-foreground hover:bg-elevated hover:text-foreground"><XIcon className="size-4" /></button>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
            {isSeller ? <button type="button" onClick={toggleSound} className="inline-flex items-center gap-2 text-sm text-foreground hover:text-gold">{soundEnabled ? <Volume2Icon className="size-4" /> : <VolumeXIcon className="size-4" />} Booking sound {soundEnabled ? "on" : "off"}</button> : <span />}
            <button type="button" disabled={pending || unread === 0} onClick={() => startTransition(async () => { const result = await markAllNotificationsReadAction(); if (result.ok) markAllLocalRead(); })} className="inline-flex items-center gap-1.5 text-sm text-gold disabled:opacity-40">{pending ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />} Mark all read</button>
          </div>
          <ul className="min-h-0 overflow-y-auto">
            {rows.length === 0 ? <li className="px-5 py-10 text-center text-sm text-muted-foreground">No notifications yet.</li> : null}
            {rows.map((row) => (
              <li key={row.id} className={`border-b border-border/70 px-5 py-4 last:border-0 ${!row.read_at ? "border-l-[3px] border-l-gold bg-gold/5" : "border-l-[3px] border-l-transparent"}`}>
                <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold leading-snug text-foreground">{row.title}</h3>{!row.read_at ? <span className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 text-[11px] font-medium text-gold">New</span> : null}</div>
                {row.body ? <p className="mt-1.5 whitespace-normal break-words text-sm leading-relaxed text-foreground/85">{row.body}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground"><LocalDateTime value={row.created_at} /></p>
                <div className="mt-3 flex items-center gap-4">
                  {row.link ? <button type="button" disabled={pending} onClick={() => markRead(row, true)} className="text-sm font-medium text-gold hover:underline disabled:opacity-40">{isBooking(row) ? "View booking" : "Open"}</button> : null}
                  {!row.read_at ? <button type="button" disabled={pending} onClick={() => markRead(row)} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40">Mark read</button> : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3"><button type="button" onClick={() => void enablePhoneAlerts()} className="text-sm text-muted-foreground hover:text-foreground">Enable phone alerts</button><Link href="/notifications" onClick={() => setOpen(false)} className="text-sm font-medium text-gold hover:underline">View all</Link></div>
        </div>
      ) : null}
    </div>
  );
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const base64 = (value + "=".repeat((4 - value.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
function keyBase64(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}
async function enablePhoneAlerts() {
  try {
    const response = await fetch("/api/push/public-key");
    if (!response.ok) return;
    const { publicKey } = await response.json();
    if (!publicKey) return;
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      if (await Notification.requestPermission() !== "granted") return;
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
    }
    const p256dh = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    if (!p256dh || !auth) return;
    await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh: keyBase64(p256dh), auth: keyBase64(auth) }, userAgent: navigator.userAgent }) });
  } catch { /* Push is optional. */ }
}
