"use client";

import { useEffect } from "react";
import { brand } from "@/lib/brand";

/**
 * Registers `/sw.js` after mount. No-ops in dev or when the browser
 * doesn't expose `navigator.serviceWorker` (e.g. older Safari).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const url = brand.pwa.serviceWorker;
    navigator.serviceWorker
      .register(url, { scope: "/" })
      .catch((err) => console.warn("[pwa] service worker registration failed", err));
  }, []);
  return null;
}
