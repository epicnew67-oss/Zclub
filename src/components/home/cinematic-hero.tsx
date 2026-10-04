"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpRightIcon, PauseIcon, PlayIcon, VideoIcon } from "lucide-react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export function CinematicHero({ videoSrc }: { videoSrc?: string }) {
  const scope = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [allowVideo, setAllowVideo] = useState(false);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowVideo(!media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from("[data-hero-copy]", { y: 24, opacity: 0, duration: 1, stagger: .12, ease: "power3.out" });
      gsap.from("[data-hero-photo]", { scale: 1.035, duration: 1.8, ease: "power2.out" });
    });
    return () => media.revert();
  }, { scope });

  function toggleVideo() {
    if (!video.current) return;
    if (video.current.paused) {
      void video.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.current.pause();
      setPlaying(false);
    }
  }

  return (
    <section ref={scope} className="campaign-hero relative isolate min-h-[43rem] overflow-hidden bg-background lg:min-h-[calc(100svh-5rem)]">
      <div data-hero-photo className="absolute inset-y-0 right-0 w-full md:w-[75%]">
        <Image src="/editorial/editorial-portrait.webp" alt="" fill priority sizes="(max-width: 768px) 100vw, 75vw" className="object-cover object-[65%_28%]" />
      </div>
      {videoSrc && allowVideo ? <video ref={video} src={videoSrc} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" onError={() => setAllowVideo(false)} className="absolute inset-0 h-full w-full object-cover object-[65%_center]" /> : null}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/5 max-md:via-background/45" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/15" />
      <div className="relative mx-auto flex min-h-[43rem] max-w-[1440px] flex-col justify-center px-5 pt-20 pb-24 md:px-10 lg:min-h-[calc(100svh-5rem)] lg:px-16">
        <p data-hero-copy className="mb-7 flex items-center gap-3 text-[11px] font-semibold tracking-[.22em] text-foreground/85 uppercase"><span className="h-px w-9 bg-gold" /> Private 1:1 video calls</p>
        <h1 data-hero-copy className="max-w-[9.5ch] font-heading text-[clamp(3.7rem,7.7vw,8.1rem)] leading-[.92] font-normal tracking-[-.06em] text-foreground">Stay for the<br /><em className="text-gold-soft">connection.</em></h1>
        <p data-hero-copy className="mt-7 max-w-[25rem] text-base leading-7 text-foreground/80 md:text-lg">Discover someone who catches your eye. Make it a private call, just the two of you.</p>
        <div data-hero-copy className="mt-9 flex flex-wrap items-center gap-5">
          <Link href="/browse" className="campaign-button inline-flex min-h-14 items-center gap-6 bg-foreground px-7 text-sm font-semibold text-background hover:bg-gold-soft">Explore sellers <ArrowUpRightIcon className="size-5" /></Link>
          <a href="#meet" className="inline-flex min-h-12 items-center gap-2 border-b border-foreground/35 text-sm text-foreground/90 hover:border-gold hover:text-gold-soft">See who is here <ArrowDownIcon className="size-4" /></a>
        </div>
        <div className="absolute right-5 bottom-7 left-5 flex items-center justify-between gap-5 border-t border-foreground/15 pt-5 text-[10px] font-medium tracking-[.12em] text-foreground/65 uppercase md:right-10 md:left-10 lg:right-16 lg:left-16">
          <span className="flex items-center gap-2"><VideoIcon className="size-4" /> Real-time. One to one.</span>
          {videoSrc && allowVideo ? <button onClick={toggleVideo} type="button" aria-label={playing ? "Pause background video" : "Play background video"} className="inline-flex items-center gap-2 text-foreground hover:text-gold-soft">{playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}<span>{playing ? "Pause" : "Play"}</span></button> : <span>Find your next conversation</span>}
        </div>
      </div>
    </section>
  );
}
