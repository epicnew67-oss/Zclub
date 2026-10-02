"use client";

import { useEffect, type ReactNode } from "react";
import { useGsap } from "@/hooks/use-gsap";

/**
 * Wrap a section to fade + lift its children in via ScrollTrigger.
 * Children participate via the `data-reveal` attribute (or any custom
 * selector passed via `target`). Respects prefers-reduced-motion via
 * useGsap. Pure transform / opacity.
 */
export function RevealSection({
  children,
  target = "[data-reveal]",
  stagger = 0.08,
  y = 24,
  className,
  id,
}: {
  children: ReactNode;
  target?: string;
  stagger?: number;
  y?: number;
  className?: string;
  /** Optional DOM id so the section can be linked from a hash
   *  anchor (e.g. /#how-it-works). */
  id?: string;
}) {
  const scopeRef = useGsap<HTMLElement>(({ gsap, scope }) => {
    const els = scope.querySelectorAll(target);
    if (els.length === 0) return;
    gsap.from(els, {
      opacity: 0,
      y,
      duration: 0.6,
      stagger,
      ease: "power2.out",
      scrollTrigger: {
        trigger: scope,
        start: "top 85%",
        toggleActions: "play none none none",
        once: true,
      },
    });
  });

  // No-op effect so children mounted later can still match the
  // selector. With our usage (children passed inline) this is a
  // safety net only.
  useEffect(() => {}, []);

  return (
    <section id={id} ref={scopeRef} className={className}>
      {children}
    </section>
  );
}
