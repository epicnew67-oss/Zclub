"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type GsapSetup<T extends HTMLElement> = (context: {
  gsap: typeof gsap;
  scope: T;
}) => void | (() => void);

/**
 * Scoped GSAP hook: runs `setup` inside gsap.context for automatic cleanup
 * (ctx.revert on unmount). Skips all animation when the user prefers
 * reduced motion.
 *
 * Returns a ref for the element that scopes the animations + selectors.
 */
export function useGsap<T extends HTMLElement = HTMLDivElement>(
  setup: GsapSetup<T>
) {
  const scopeRef = useRef<T | null>(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useIsomorphicLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => setupRef.current({ gsap, scope }), scope);
    return () => ctx.revert();
  }, []);

  return scopeRef;
}
