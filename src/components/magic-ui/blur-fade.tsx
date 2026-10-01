"use client";

import { Children, isValidElement, useRef } from "react";
import { useGsap } from "@/hooks/use-gsap";

/**
 * BlurFade — GSAP-powered entrance reveal pattern.
 *
 * Adapted from magicui/blur-fade. Each direct child of this
 * component fades + lifts in from y=offset with a slight blur,
 * staggered on a short delay so the cascade reads as a single
 * editorial entrance rather than a sequence.
 *
 * GSAP-driven (not framer-motion) so it sits inside the existing
 * motion stack — the hook respects prefers-reduced-motion and is
 * cleaned up via gsap.context on unmount.
 *
 * Usage: wrap an array of sibling elements. Each becomes one
 * stagger step; the wrapper itself is not animated.
 */
export function BlurFade({
  children,
  delay = 0,
  duration = 0.9,
  yOffset = 18,
  blur = 10,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  yOffset?: number;
  blur?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scopeRef = useGsap<HTMLDivElement>(({ gsap, scope }) => {
    const items = scope.querySelectorAll("[data-blur-fade-item]");
    if (items.length === 0) return;
    gsap.from(items, {
      opacity: 0,
      y: yOffset,
      filter: `blur(${blur}px)`,
      duration,
      stagger: 0.12,
      delay,
      ease: "power2.out",
    });
  });

  // Wrap each child with the data attribute so GSAP can target it.
  // Display:contents keeps the layout flat (no extra box around
  // each child) while still letting GSAP animate transform/opacity.
  const wrapped = Children.map(children, (child, i) => (
    <div
      key={isValidElement(child) && child.key ? child.key : i}
      data-blur-fade-item
      style={{ display: "contents" }}
    >
      {child}
    </div>
  ));

  return (
    <div
      ref={(node) => {
        scopeRef.current = node;
        containerRef.current = node;
      }}
      className={className}
    >
      {wrapped}
    </div>
  );
}
