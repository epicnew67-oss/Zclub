"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { useGsap } from "@/hooks/use-gsap";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * FloatingNavbar — premium editorial navbar for logged-out visitors.
 *
 * Inspired by Aceternity's floating pill pattern + Magic UI Pro header
 * + React Bits Navigation 13: a centered, translucent pill that
 * hides on scroll-down and reappears on scroll-up.
 *
 * Composition (left → right):
 *   • Compact SC mark (logo + wordmark in the same pill, gold wordmark)
 *   • Minimal nav links: Browse, How it works
 *   • Sign In (quiet outline button)
 *   • Join Now (single prominent burgundy CTA — the only strong colour
 *     in the navbar so the eye lands on it)
 *
 * Interaction:
 *   • Hidden when scrolling down past 80px (translateY(-200%))
 *   • Revealed when scrolling up or near the top
 *   • Active nav link gets a small gold underline that slides between
 *     links via GSAP (cheap inline style write per route change)
 *
 * Mobile:
 *   • Pill compresses to just the SC mark + hamburger
 *   • Hamburger opens a full-height overlay menu with the same nav
 *     + Sign In + Join Now stacked vertically
 */
export function FloatingNavbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  // Scroll hide/reveal. We use a direct scroll listener (no GSAP needed)
  // because the animation is a single translateY write per scroll event,
  // not a multi-step tween. The listener stays passive and rAF-throttled
  // so it never blocks the main thread.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    let lastY = window.scrollY;
    let lastDir: "up" | "down" | null = null;
    let frame: number | null = null;

    const update = () => {
      const y = window.scrollY;
      const dir = y > lastY ? "down" : y < lastY ? "up" : lastDir;
      const shouldHide =
        y > 80 && dir === "down" && !mobileOpen;
      el.style.transform = shouldHide
        ? "translate(-50%, -200%)"
        : "translate(-50%, 0)";
      el.dataset.visible = shouldHide ? "false" : "true";
      lastY = y;
      lastDir = dir;
      frame = null;
    };

    const onScroll = () => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [mobileOpen]);

  // Animated gold underline on the active nav link. We position a
  // single <span> under the pill using GSAP quickTo so the slide
  // is smooth across route changes. Cheap — one observer + one write.
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const scopeRef = useGsap<HTMLDivElement>(({ gsap }) => {
    const active = document.querySelector<HTMLElement>("[data-nav-active]");
    const indicator = indicatorRef.current;
    if (!active || !indicator) return;
    const moveTo = gsap.quickTo(indicator, "x", {
      duration: 0.4,
      ease: "power3.out",
    });
    const widthTo = gsap.quickTo(indicator, "width", {
      duration: 0.4,
      ease: "power3.out",
    });
    const target =
      indicator.parentElement?.querySelector<HTMLElement>(
        `[data-nav-target="${active.dataset.navActive}"]`,
      );
    if (target) {
      const rect = target.getBoundingClientRect();
      const parentRect = target.parentElement!.getBoundingClientRect();
      moveTo(rect.left - parentRect.left + rect.width / 2 - 8);
      widthTo(16);
    }
  });

  const links = [
    { href: "/browse", label: "Browse" },
    { href: "/#how-it-works", label: "How it works", scrollTarget: "how-it-works" },
  ];

  const activeKey = pathname.startsWith("/browse")
    ? "/browse"
    : pathname === "/"
      ? "/"
      : null;

  // Smooth-scroll handler for in-page anchors like /#how-it-works.
  // If we're already on the home route, intercept the click and
  // scroll smoothly to the target section. Otherwise let the Link
  // navigate normally — the hash will be handled by the browser on
  // the destination page.
  const handleLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    link: (typeof links)[number]
  ) => {
    const targetId = link.scrollTarget;
    if (!targetId) return;
    if (pathname !== "/") return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // Keep the hash in the URL so deep-linking and the back button
    // still work — update without re-scrolling.
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", `/#${targetId}`);
    }
  };

  return (
    <>
      <header
        ref={navRef}
        data-visible="true"
        className="fixed top-4 left-1/2 z-40 transition-transform duration-500 ease-out md:top-6"
        style={{ transform: "translate(-50%, 0)" }}
      >
        <nav
          ref={scopeRef}
          aria-label="Primary"
          className={cn(
            "relative flex items-center gap-2 rounded-full",
            "border border-gold/20 bg-background/80 shadow-soft backdrop-blur-xl",
            "h-12 px-3 md:h-14 md:gap-4 md:px-4",
          )}
        >
          {/* Brand — compact SC mark + wordmark, both clickable as one. */}
          <Link
            href="/"
            aria-label="StripClub — home"
            className="flex shrink-0 items-center rounded-full pr-1 md:pr-2"
          >
            <Logo size="sm" className="md:hidden" />
            <Logo size="md" className="hidden md:inline-flex" />
          </Link>

          <div className="hidden items-center md:flex">
            <span
              aria-hidden
              className="mx-1 h-5 w-px bg-gold/20"
            />
          </div>

          {/* Nav links — minimal: just Browse + How it works on desktop. */}
          <ul className="relative hidden items-center md:flex">
            {links.map((link) => {
              const active = activeKey === link.href;
              return (
                <li key={link.href} className="relative">
                  <Link
                    href={link.href}
                    onClick={(event) => handleLinkClick(event, link)}
                    data-nav-target={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
            {/* Sliding gold underline indicator. x + width set by the
                GSAP quickTo above based on the active link's position. */}
            <span
              ref={indicatorRef}
              aria-hidden
              className="pointer-events-none absolute bottom-1 h-px w-4 rounded-full bg-gold"
            />
          </ul>

          {/* Right cluster: Sign In (quiet) + Join Now (the only
              strong colour in the navbar). */}
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="hidden h-8 rounded-full bg-burgundy px-4 text-xs font-semibold text-foreground shadow-glow hover:bg-burgundy/90 md:inline-flex"
            >
              <Link href="/auth/sign-up">Join now</Link>
            </Button>

            {/* Mobile hamburger. */}
            <button
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="floating-mobile-menu"
              onClick={() => setMobileOpen((open) => !open)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gold/20 text-muted-foreground transition-colors hover:text-foreground md:hidden"
            >
              {mobileOpen ? (
                <XIcon className="size-4" />
              ) : (
                <MenuIcon className="size-4" />
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile overlay menu. Renders only on small screens; closes on
          route change. Full-height with strong burgundy background so
          the brand mood carries through. */}
      {mobileOpen ? (
        <div
          id="floating-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
          className="fixed inset-0 z-30 flex flex-col bg-background/95 px-6 pt-24 pb-8 backdrop-blur-2xl md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={(event) => {
                    handleLinkClick(event, link);
                    setMobileOpen(false);
                  }}
                  className="block rounded-2xl px-5 py-4 font-heading text-2xl font-medium tracking-tight text-foreground transition-colors hover:bg-surface/40 hover:text-gold"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-auto flex flex-col gap-3">
            <Button
              asChild
              variant="outline"
              size="lg"
              className="w-full border-gold/50 text-gold"
            >
              <Link
                href="/auth/sign-in"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="w-full bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90"
            >
              <Link
                href="/auth/sign-up"
                onClick={() => setMobileOpen(false)}
              >
                Join now
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
