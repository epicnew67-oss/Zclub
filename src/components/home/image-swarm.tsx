"use client";

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "@/lib/gsap";
import { ScrollTrigger } from "@/lib/gsap";
import { CustomEase } from "gsap/CustomEase";
import Lenis from "lenis";

gsap.registerPlugin(CustomEase);
CustomEase.create("fluidPop", "0.175, 0.885, 0.32, 1.275");
CustomEase.create("fluidFloat", "0.7, 0, 0.3, 1");

export type SwarmImage = {
  url: string;
  alt: string;
};

/**
 * ImageSwarm — the primary hero visual, ported from
 * Nischint007/Image-Swarm (script.js) into the project's GSAP setup.
 *
 * Choreography (scroll-scrubbed, pinned):
 *   1. Pop-in  — tiles scale from 0 at the centre, staggered from the
 *      middle of the set outward (fluidPop).
 *   2. Scatter — tiles glide to their grid slots (±35vw / ±32vh with organic
 *      noise, ±12° rotation, fluidFloat).
 *   3. Exit    — the whole swarm flies up (-110vh) as the user scrolls on.
 *
 * Data-driven: `images` are real, approved listing photos (signed URLs
 * produced server-side). When the marketplace has no approved photos
 * yet, the swarm renders no tiles at all — never empty placeholder
 * rectangles — and falls back to a subtle brand atmosphere so the hero
 * still reads as intentional. As sellers publish real listings, the
 * swarm picks them up automatically with no code changes.
 *
 * Reduced-motion users get a static layout (no pin, no tween).
 */
export function ImageSwarm({
  sectionRef,
  images,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  images: SwarmImage[];
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hasImages = images.length > 0;

  // Lenis smooth scroll, synced to GSAP's ticker (as in the reference).
  // Only attached while the swarm is actually rendered, so pages
  // without media keep the browser's native scrolling.
  useEffect(() => {
    if (!hasImages) return;
    const lenis = new Lenis({
      lerp: 0.06,
      smoothWheel: true,
      syncTouch: true,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.1,
      infinite: false,
    });
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenis.on("scroll", ScrollTrigger.update);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, [hasImages]);

  // The swarm timeline. Runs inside gsap.context on the stage so it
  // reverts cleanly on unmount.
  useEffect(() => {
    const stage = stageRef.current;
    const section = sectionRef.current;
    if (!stage || !section || !hasImages) return;

    const tiles = stage.querySelectorAll<HTMLElement>("[data-swarm-tile]");
    if (tiles.length === 0) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) return; // static grid — no pin, no tween

    const ctx = gsap.context(() => {
      const cols = tiles.length >= 4 ? 4 : tiles.length;
      const rows = Math.ceil(tiles.length / cols);

      // Intentional destination positions (same algorithm as the source).
      const positions = Array.from(tiles).map((_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const xBase = cols > 1
          ? gsap.utils.interpolate(-35, 35, col / (cols - 1))
          : 0;
        const yBase = rows > 1
          ? gsap.utils.interpolate(-32, 32, row / (rows - 1))
          : 0;
        return {
          x: xBase + gsap.utils.random(-4, 4),
          y: yBase + gsap.utils.random(-4, 4),
          rotation: gsap.utils.random(-12, 12),
        };
      });

      // Switch the stage from the static grid to absolute positioning
      // before any tween runs.
      stage.style.display = "block";
      tiles.forEach((tile, i) => {
        const w = gsap.utils.random(10, 16);
        const h = gsap.utils.random(25, 32);
        tile.style.width = `${w}vw`;
        tile.style.height = `${h}vh`;
        gsap.set(tile, {
          position: "absolute",
          top: "50%",
          left: "50%",
          xPercent: -50,
          yPercent: -50,
          x: 0,
          y: 0,
          scale: 0,
          rotation: positions[i].rotation,
        });
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "+=2600",
          pin: true,
          scrub: 1,
        },
      });

      // 1. Pop-in from centre.
      tl.to(tiles, {
        scale: 1,
        duration: 2.2,
        stagger: { each: 0.2, from: "center" },
        ease: "fluidPop",
      });

      // 2. Scatter into the grid.
      tl.to(
        tiles,
        {
          x: (i) => `${positions[i].x}vw`,
          y: (i) => `${positions[i].y}vh`,
          rotation: (i) => positions[i].rotation,
          duration: 2.2,
          stagger: { each: 0.2, from: "center", grid: [rows, cols] },
          ease: "fluidFloat",
        },
        "+=0.85",
      );

      // 3. Exit — the swarm flies up and out of the viewport.
      tl.to(
        tiles,
        {
          y: (i) => `${positions[i].y - 110}vh`,
          rotation: 0,
          duration: 2.6,
          stagger: { each: 0.2, from: "center", grid: [rows, cols] },
          ease: "fluidFloat",
        },
        "+=1.1",
      );
    }, stage);

    return () => ctx.revert();
  }, [sectionRef, hasImages]);

  if (!hasImages) {
    // No approved photos yet — no placeholder tiles. A subtle brand
    // wash keeps the hero intentional until real media exists.
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(102,14,18,0.3),transparent_55%),radial-gradient(ellipse_at_75%_70%,rgba(194,161,123,0.16),transparent_60%)]"
      />
    );
  }

  return (
    <div ref={stageRef} data-swarm-stage aria-hidden="true">
      {images.map((image, i) => (
        <div key={`${image.url}-${i}`} data-swarm-tile className="swarm-tile">
          {/* Real approved listing photo (signed URL from the server). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.alt}
            loading={i < 4 ? "eager" : "lazy"}
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}
