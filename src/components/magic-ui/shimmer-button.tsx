"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * ShimmerButton — primary CTA with an animated gold shimmer sweep.
 *
 * Pattern adapted from magicui/shimmer-button. Single sweep
 * animation across the button on hover, plus a permanent subtle
 * gold-gradient border ring so the CTA reads as the page's primary
 * action even at rest.
 *
 * The sweep uses CSS-only @keyframes — no GSAP needed so it stays
 * free of extra JS load on hover and works without JS.
 */
export function ShimmerButton({
  href,
  children,
  className,
  size = "lg",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  const sizeClass =
    size === "lg" ? "h-12 px-7 text-base" : "h-10 px-5 text-sm";

  return (
    <Link
      href={href}
      className={cn(
        "group relative inline-flex items-center justify-center overflow-hidden rounded-full",
        "font-medium tracking-wide text-foreground",
        "transition-all duration-300",
        // Base surface — burgundy drives primary actions.
        "bg-burgundy shadow-glow",
        "hover:bg-burgundy/90 hover:shadow-[0_0_36px_-6px_rgba(102,14,18,0.7)]",
        sizeClass,
        className,
      )}
    >
      {/* Shimmer sweep — pure CSS keyframe, sits above the button
          background, below the label. pointer-events-none so the
          sweep never steals the click. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(110deg,transparent_25%,rgba(255,235,205,0.55)_50%,transparent_75%)] transition-transform duration-700 group-hover:translate-x-full"
      />
      {/* Hairline gold ring so the button reads as a focal CTA even
          before hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-gold/40 group-hover:ring-gold/70"
      />
      <span className="relative">{children}</span>
    </Link>
  );
}
