/**
 * StripClub service worker.
 *
 * - Cache the brand + manifest + offline fallback so the PWA shell
 *   launches without network.
 * - Listen for `push` events from the server (VAPID) and show a
 *   notification; clicking the notification focuses an existing tab
 *   on the link if one is open, otherwise opens it.
 *
 * Push subscription is created client-side in `src/lib/push-client.ts`
 * and persisted to `push_subscriptions` via the server actions in
 * `src/app/notifications/actions.ts`.
 */

const CACHE = "stripclub-shell-v1";
const SHELL = ["/manifest.webmanifest", "/brand/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title><body style='background:#0A0506;color:#F3ECE4;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px'><div><h1 style='color:#C8A57A;font-family:Playfair Display,serif;margin:0 0 8px'>You're offline</h1><p style='color:#A89A8C;margin:0'>Reconnect to see new updates.</p></div></body>",
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          )
      )
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "StripClub", body: "You have a new alert.", link: "/notifications", tag: "stripclub" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/brand/icon.svg",
      badge: "/brand/icon.svg",
      tag: payload.tag,
      data: { link: payload.link },
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.postMessage({ type: "navigate", link });
          return w.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
