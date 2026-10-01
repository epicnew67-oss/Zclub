"use client";

import { cn } from "cn";

/**
 * Marquee — infinite-scroll editorial strip.
 *
 * Pattern adapted from magicui/marquee. Renders its children
 * twice side by side and animates the parent translateX from 0 to
 * -50% so the second copy seamlessly continues the first. CSS-only
 * — no GSAP needed. Pauses on hover.
 *
 * Used for the editorial category strip below the hero.
 */
export function Marquee({
  children,
  className,
  speed = 36,
  reverse = false,
  pauseOnHover = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Seconds for one full loop. */
  speed?: number;
  reverse?: boolean;
  pauseOnHover?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative flex w-full overflow-hidden",
        "[--duration:36s] [--gap:2.5rem] [gap:var(--gap)]",
        className,
      )}
      style={
        {
          ["--duration" as string]: `${speed}s`,
        } as React.CSSProperties
      }
    >
      <div
        className={cn(
          "flex shrink-0 items-center [gap:var(--gap)]",
          "animate-marquee will-change-transform",
          reverse && "[animation-direction:reverse]",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
        )}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          "flex shrink-0 items-center [gap:var(--gap)]",
          "animate-marquee will-change-transform",
          reverse && "[animation-direction:reverse]",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
        )}
      >
        {children}
      </div>

      {/* Edge fade so the strip reads as editorial motion rather
          than a hard cutoff. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
