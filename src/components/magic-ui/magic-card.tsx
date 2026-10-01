"use client";

import { useRef } from "react";
import { cn } from "cn";

/**
 * MagicCard — interactive surface with cursor-following spotlight +
 * subtle gradient ring.
 *
 * Pattern adapted from magicui/magic-card. Tracks the cursor via
 * a per-element ref + onMouseMove handler that writes CSS variables
 * for a radial-gradient overlay. Cheap (no GSAP needed, ~3 style
 * writes per move).
 *
 * `bare` mode strips the default gold border + background so the
 * component can layer its cursor spotlight on top of an existing
 * styled surface (e.g. a `Link` row inside a category grid).
 */
export function MagicCard({
  children,
  className,
  spotlightColor = "rgba(194, 161, 123, 0.18)",
  borderColor = "rgba(194, 161, 123, 0.18)",
  bare = false,
}: {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: string;
  borderColor?: string;
  /**
   * Strip the default border + surface background so only the
   * cursor spotlight + transitions remain. Use when wrapping an
   * existing styled surface (e.g. simple link rows).
   */
  bare?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--mx", `-9999px`);
    el.style.setProperty("--my", `-9999px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn(
        "group/mcard relative overflow-hidden rounded-xl transition-all duration-300",
        !bare &&
          "border bg-surface/40 hover:border-gold/60 hover:shadow-gold",
        className,
      )}
      style={
        bare
          ? {
              ["--mx" as string]: `-9999px`,
              ["--my" as string]: `-9999px`,
              ["--spotlight" as string]: spotlightColor,
            }
          : {
              ["--mx" as string]: `-9999px`,
              ["--my" as string]: `-9999px`,
              ["--spotlight" as string]: spotlightColor,
              ["--ring" as string]: borderColor,
              borderColor: "var(--ring)",
            }
      }
    >
      {/* Cursor spotlight overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/mcard:opacity-100"
        style={{
          background:
            "radial-gradient(220px_circle_at_var(--mx)_var(--my),var(--spotlight),transparent_70%)",
        }}
      />
      {children}
    </div>
  );
}
