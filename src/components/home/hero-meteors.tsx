"use client";

import { Meteors } from "@/components/ui/meteors";

/**
 * HeroMeteors — the dominant atmospheric layer behind the masthead.
 *
 * Three layers of Meteors stacked to feel like a real meteor shower:
 *   - dense short streaks (60 total) — the base rainfall
 *   - sparse long bright streaks (12) — hero moments
 *   - reverse direction (8) — slight asymmetry so the field doesn't
 *     read as a single uniform pattern
 *
 * All streaks are gold (`bg-gold` head + `from-gold` tail) so the
 * shower ties into the brand palette without competing with the
 * HeroAtmosphere (burgundy wash + gold accent) sitting behind it.
 *
 * Sized to feel "like an actual brand" — bigger than the default
 * shadcn Meteors (size 1 instead of 0.5, tail 20 instead of 12.5).
 *
 * Pointer-events: none so the masthead stays clickable even when a
 * streak passes under it.
 */
export function HeroMeteors() {
  return (
    <div
      data-hero-meteors
      aria-hidden
      className="pointer-events-none absolute inset-0 isolate overflow-hidden"
    >
      {/* Dense base rainfall — small, fast, gold. */}
      <Meteors
        number={60}
        minDelay={0}
        maxDelay={0.8}
        minDuration={3}
        maxDuration={7}
        angle={215}
        headClassName="!bg-gold"
        tailClassName="!from-gold"
      />

      {/* Sparse hero streaks — larger, slower, brighter glow. */}
      <Meteors
        number={12}
        minDelay={0.2}
        maxDelay={1.4}
        minDuration={6}
        maxDuration={12}
        angle={215}
        className="!size-1 !shadow-[0_0_10px_2px_rgba(194,161,123,0.45)]"
        headClassName="!bg-gold-soft"
        tailClassName="!from-gold-soft !w-25"
      />

      {/* Reverse drift — sparse, slow, opposite angle for asymmetry. */}
      <Meteors
        number={8}
        minDelay={0.4}
        maxDelay={1.8}
        minDuration={10}
        maxDuration={18}
        angle={35}
        className="!size-0.5"
        headClassName="!bg-gold/70"
        tailClassName="!from-gold/70"
      />
    </div>
  );
}
