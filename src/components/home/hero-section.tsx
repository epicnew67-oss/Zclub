"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useGsap } from "@/hooks/use-gsap";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HeroMeteors } from "@/components/home/hero-meteors";
import { ShimmerButton } from "@/components/magic-ui/shimmer-button";

export type HeroStat = {
  label: string;
  /** Final number to count up to. Non-finite values render as 0. */
  value: number;
};

/** Normalizes any stat value to a safe non-negative integer (never NaN). */
function statValue(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Formats a counter for display; never renders "NaN". */
function formatStat(raw: unknown): string {
  return statValue(raw).toLocaleString("en-US");
}

/** Homepage masthead with entrance animation and normalized live counters. */
export function HeroSection({
  headline,
  tagline,
  stats,
  signedIn = false,
}: {
  headline: ReactNode;
  tagline: string;
  stats: HeroStat[];
  signedIn?: boolean;
}) {
  const scopeRef = useGsap<HTMLElement>(({ gsap }) => {
    // Brand-content entrance. Power2 out + small stagger so the
    // masthead reads as a single cascading reveal. HeroMeteors runs
    // on its own timeline so this one only
    // orchestrates the foreground content.
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from("[data-hero-item]", {
      opacity: 0,
      y: 24,
      duration: 0.8,
      stagger: 0.08,
    })
      .fromTo(
        "[data-counter-target]",
        // Explicit numeric start — GSAP never parses the formatted
        // SSR text (e.g. "1,200"), which is what produced NaN before.
        { innerText: 0 },
        {
          innerText: (_i: number, target: HTMLElement) =>
            statValue(target.dataset.counterTarget),
          duration: 1.4,
          snap: { innerText: 1 },
          modifiers: {
            innerText: (value: unknown) => formatStat(value),
          },
          ease: "power1.out",
        },
        0.4,
      );
  });

  return (
    <section
      ref={scopeRef}
      className="relative isolate min-h-[100svh] overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(102,14,18,0.3),transparent_55%),radial-gradient(ellipse_at_75%_70%,rgba(194,161,123,0.16),transparent_60%)]"
      />

      <HeroMeteors />

      {/* Centered brand masthead above the atmospheric background. */}
      <div className="relative mx-auto flex min-h-[100svh] max-w-5xl flex-col items-center justify-center gap-6 px-4 pt-24 pb-20 text-center md:px-6 md:pt-28 md:pb-28">
        <div data-hero-item className="flex flex-col items-center gap-5 md:gap-6">
          <Badge variant="gold-outline" className="px-3 py-1 text-[10px]">
            Token escrow · Verified creators
          </Badge>

          <Logo
            variant="mark"
            size="xl"
            className="drop-shadow-[0_0_42px_rgba(194,161,123,0.28)]"
          />

          <span
            aria-hidden
            className="block h-px w-20 bg-gradient-to-r from-transparent via-gold/70 to-transparent md:w-28"
          />

          <Logo variant="wordmark" size="lg" />
        </div>

        <h1
          data-hero-item
          className="mx-auto max-w-3xl font-heading text-3xl font-medium italic leading-tight tracking-tight text-foreground/95 md:text-5xl"
        >
          {headline}
        </h1>

        <p
          data-hero-item
          className="mx-auto max-w-md text-sm text-muted-foreground md:text-base"
        >
          {tagline}
        </p>

        <div
          data-hero-item
          className="mt-1 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          {signedIn ? (
            <>
              <ShimmerButton href="/browse">Browse listings</ShimmerButton>
              <Button asChild size="lg" variant="outline">
                <Link href="/become-a-seller">Become a seller</Link>
              </Button>
            </>
          ) : (
            <>
              <ShimmerButton href="/auth/sign-up">Join now</ShimmerButton>
              <Button asChild size="lg" variant="outline">
                <Link href="/browse">Browse listings</Link>
              </Button>
            </>
          )}
        </div>

        {!signedIn ? (
          <p data-hero-item className="text-xs text-muted-foreground">
            Already a member?{" "}
            <Link
              href="/auth/sign-in"
              className="font-medium text-gold underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        ) : null}

        {/* Real DB counts — a genuine zero renders "0", never NaN. */}
        <dl
          data-hero-item
          className="mt-8 grid w-full max-w-3xl grid-cols-3 gap-3 rounded-2xl border border-gold/15 bg-surface/30 px-4 py-5 backdrop-blur md:gap-6 md:px-6 md:py-6"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1">
              <dt className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground md:text-[10px]">
                {stat.label}
              </dt>
              <dd className="font-heading text-xl font-semibold text-gold md:text-2xl">
                <span data-counter data-counter-target={statValue(stat.value)}>
                  {formatStat(stat.value)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Bottom edge fade into the next section. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background"
      />
    </section>
  );
}
