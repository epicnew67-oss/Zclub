/**
 * StripClub — single source of truth for the brand and design tokens.
 *
 * Everything visual (name, colors, fonts, logo paths, radius, shadows) is
 * defined here and injected at runtime as CSS variables by <BrandStyle />
 * (see src/components/brand/brand-style.tsx) in the root layout. Tailwind
 * maps those variables to utilities in src/app/globals.css (@theme inline).
 *
 * Nothing brand-related is hardcoded in pages — change a value here and the
 * whole site updates. The logo itself lives as inline SVG inside <Logo />
 * and reads its colors from brand.colors so the entire system stays in
 * sync. App-icon / favicon SVGs in /public/brand/ mirror the same paths.
 */

export const brand = {
  name: "StripClub",
  shortName: "SC",
  domain: "stripclubonline.store",
  tagline: "Exclusive 1:1 video moments, booked in tokens.",
  description:
    "StripClub is a marketplace for on-demand 1:1 video calls. Buy tokens, choose an available seller, and join your call.",
  colors: {
    // Surfaces
    bg: "#0A0506", // near-black base (subtle burgundy glow applied in layout)
    surface: "#14090C", // cards
    elevated: "#1D0E12", // raised panels / inputs
    overlay: "#241218", // popovers, modals, menus
    onGold: "#17100B", // dark text/icons on gold surfaces
    // Text
    text: "#F3ECE4", // off-white
    textMuted: "#A89A8C", // muted
    // Lines
    line: "#2B181E", // borders / dividers
    lineStrong: "#3A2128", // input borders
    // Accents — gold is the accent, burgundy is for primary actions.
    // Sampled from the production StripClub logo artwork.
    gold: "#c2a17b",
    goldSoft: "#d8bda0",
    goldDeep: "#876d52",
    burgundy: "#660e12",
    burgundyDeep: "#44070d",
    // Status
    success: "#5BA56B",
    danger: "#E5484D",
  },
  fonts: {
    display: "var(--font-playfair)", // headings / brand wordmark
    body: "var(--font-inter)", // body / UI
  },
  /** Logo asset paths — the only place file paths live. */
  logo: {
    favicon: "/brand/favicon.svg",
    appleTouchIcon: "/brand/icon.svg",
    icon192: "/brand/icon.svg",
    icon512: "/brand/icon.svg",
    maskable: "/brand/icon-maskable.svg",
    mark: "/brand/logo-mark.svg",
  },
  pwa: {
    manifest: "/manifest.webmanifest",
    serviceWorker: "/sw.js",
    splashColor: "#0A0506",
    themeColor: "#0A0506",
  },
  radius: {
    base: "0.75rem", // --radius
    sm: "0.45rem",
    md: "0.6rem",
    lg: "0.75rem",
    xl: "1.05rem",
  },
  shadows: {
    soft: "0 2px 12px rgba(0, 0, 0, 0.45)",
    gold: "0 2px 18px rgba(194, 161, 123, 0.28)",
    glow: "0 0 28px -6px rgba(102, 14, 18, 0.62), 0 0 70px -22px rgba(194, 161, 123, 0.18)",
  },
} as const;

export type Brand = typeof brand;
