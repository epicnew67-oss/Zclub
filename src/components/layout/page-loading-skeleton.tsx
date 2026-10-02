"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

function Block({ className = "" }: { className?: string }) {
  return (
    <div data-skeleton className={`relative overflow-hidden rounded-md bg-elevated ${className}`}>
      <span data-shimmer aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-transparent via-gold/10 to-transparent" />
    </div>
  );
}

export function PageLoadingSkeleton() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo("[data-skeleton]", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.035, ease: "power1.out" });
    gsap.fromTo("[data-shimmer]", { xPercent: -100 }, { xPercent: 100, duration: 1.4, repeat: -1, stagger: 0.08, ease: "none" });
  }, { scope: root });

  return (
    <div ref={root} role="status" aria-label="Loading page" aria-busy="true" className="mx-auto w-full max-w-6xl space-y-7 px-4 py-8 md:px-6 md:py-12">
      <span className="sr-only">Loading page</span>
      <div className="space-y-3">
        <Block className="h-4 w-28" />
        <Block className="h-9 w-64 max-w-full" />
        <Block className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-4 rounded-xl border border-border/70 p-4">
            <Block className="h-32 w-full" />
            <Block className="h-5 w-2/3" />
            <Block className="h-4 w-full" />
            <Block className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
