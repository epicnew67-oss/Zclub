/**
 * StripClub — single source of truth for the brand and design tokens.
 *
 * Everything visual (name, colors, fonts, logo paths, radius, shadows) is
 * defined here and injected at runtime as CSS variables by <BrandStyle />
 * (see src/components/brand/brand-style.tsx) in the root layout. Tailwind
 * maps those variables to utilities in src/app/globals.css (@theme inline).
 *
 * Nothing brand-related is hardcoded in pages — change a value here and the
 * whole site updates. The crest is extracted from the supplied logo art
 * and served as optimized PNG assets in /public/brand/.
 */

export const brand = {
  name: "StripClub",
  shortName: "SC",
  domain: "stripclubonline.store",
  tagline: "Private calls. Your moment.",
  description:
    "StripClub is a marketplace for on-demand 1:1 video calls. Buy tokens, choose an available seller, and join your call.",
  colors: {
    // Surfaces
    bg: "#0D0A09",
    surface: "#191411",
    elevated: "#251D18",
    overlay: "#2C211B",
    onGold: "#19110C",
    // Text
    text: "#F6F0E8",
    textMuted: "#B9A99C",
    // Lines
    line: "#48382E",
    lineStrong: "#695141",
    // Accents — gold is the accent, burgundy is for primary actions.
    // Sampled from the production StripClub logo artwork.
    gold: "#C2A17B",
    goldSoft: "#E5CBA9",
    goldDeep: "#9E7854",
    burgundy: "#660E12",
    burgundyDeep: "#420A0C",
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
    favicon: "/brand/crest-favicon.png",
    appleTouchIcon: "/brand/crest-apple-touch.png",
    icon192: "/brand/crest-icon-192.png",
    icon512: "/brand/crest-icon-512.png",
    maskable: "/brand/crest-maskable-512.png",
    mark: "/brand/crest.png",
  },
  pwa: {
    manifest: "/manifest.webmanifest",
    serviceWorker: "/sw.js",
    splashColor: "#0D0A09",
    themeColor: "#0D0A09",
  },
  radius: {
    base: "0.45rem",
    sm: "0.25rem",
    md: "0.35rem",
    lg: "0.45rem",
    xl: "0.7rem",
  },
  shadows: {
    soft: "0 18px 45px rgba(0, 0, 0, 0.24)",
    gold: "0 0 0 1px rgba(194, 161, 123, 0.22)",
    glow: "0 18px 45px rgba(0, 0, 0, 0.26)",
  },
} as const;

export type Brand = typeof brand;
