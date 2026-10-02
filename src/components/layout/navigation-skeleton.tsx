"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { gsap } from "@/lib/gsap";
import { Skeleton } from "@/components/ui/skeleton";

/** Gives immediate feedback for client transitions that wait on server data. */
export function NavigationSkeleton() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest("a[href]");
      if (!link || link.hasAttribute("download") || link.getAttribute("target") === "_blank") return;
      const target = new URL(link.getAttribute("href")!, window.location.href);
      if (target.origin !== window.location.origin || target.pathname === window.location.pathname && target.search === window.location.search) return;
      if (delay.current) clearTimeout(delay.current);
      if (timeout.current) clearTimeout(timeout.current);
      delay.current = setTimeout(() => setPending(true), 120);
      timeout.current = setTimeout(() => setPending(false), 8000);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (delay.current) clearTimeout(delay.current);
    const frame = requestAnimationFrame(() => setPending(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    if (!pending || !overlay.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tween = gsap.fromTo(overlay.current, { opacity: 0 }, { opacity: 1, duration: 0.18 });
    return () => { tween.kill(); };
  }, [pending]);

  useEffect(() => () => {
    if (delay.current) clearTimeout(delay.current);
    if (timeout.current) clearTimeout(timeout.current);
  }, []);

  if (!pending) return null;
  return <div ref={overlay} role="status" aria-label="Loading page" className="fixed inset-0 z-[90] overflow-hidden bg-background/95 px-4 py-24 backdrop-blur-sm">
    <div className="mx-auto max-w-5xl space-y-5"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-4 w-2/3" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="rounded-xl border border-border p-4"><Skeleton className="aspect-video w-full" /><Skeleton className="mt-4 h-5 w-3/4" /><Skeleton className="mt-3 h-4 w-1/2" /></div>)}</div></div>
  </div>;
}
