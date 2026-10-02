"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export function EditorialHeroMotion() {
  useGSAP(() => {
    const section = document.querySelector<HTMLElement>("[data-editorial-hero]");
    if (!section) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const copy = section.querySelectorAll("[data-hero-reveal]");
      const image = section.querySelector("[data-hero-image]");
      gsap.from(copy, { autoAlpha: 0, y: 22, duration: 1, stagger: 0.15, ease: "power2.out" });
      if (image) gsap.from(image, { autoAlpha: 0, x: 28, duration: 1.15, ease: "power2.out" });
      section.querySelectorAll("[data-cinematic-frame]").forEach((frame, index) => {
        gsap.to(frame, {
          scale: 1.1,
          xPercent: index % 2 === 0 ? -2 : 2,
          yPercent: index === 1 ? 2 : -2,
          duration: 14 + index * 3,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });
      });
    });
    return () => media.revert();
  }, []);
  return null;
}
