"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap";
import { Logo } from "@/components/brand/Logo";

const SESSION_KEY = "sc-intro-played";

/**
 * Boot loading screen: mark logo fades/scales in, then the overlay fades out.
 * Total run time stays under 1.2s. Any click or key press skips straight to
 * the end, and users who prefer reduced motion get a static overlay that
 * dismisses almost immediately.
 */
export function LoadingScreen() {
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      setDone(true);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, "1");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(() => setDone(true), 250);
      return () => window.clearTimeout(timer);
    }

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => setDone(true),
      });

      timeline
        .fromTo(
          "[data-intro-mark]",
          { opacity: 0, scale: 0.82, filter: "blur(8px)" },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.5 }
        )
        .fromTo(
          "[data-intro-word]",
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.25 },
          "-=0.15"
        )
        .to(rootRef.current, { opacity: 0, duration: 0.3, delay: 0.15 });

      const skip = () => timeline.progress(1);
      window.addEventListener("pointerdown", skip);
      window.addEventListener("keydown", skip);
      return () => {
        window.removeEventListener("pointerdown", skip);
        window.removeEventListener("keydown", skip);
      };
    }, rootRef);

    return () => ctx.revert();
  }, []);

  if (done) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-4 bg-background"
    >
      <div data-intro-mark>
        <Logo variant="mark" size="lg" />
      </div>
      <div data-intro-word>
        <Logo variant="wordmark" size="md" />
      </div>
    </div>
  );
}
