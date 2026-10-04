/**
 * StripClub — single source of truth for the brand and design tokens.
 *
 * Everything visual (name, colors, fonts, logo paths, radius, shadows) is
 * defined here and injected at runtime as CSS variables by <BrandStyle />
 * (see src/components/brand/brand-style.tsx) in the root layout. Tailwind
 * maps those variables to utilities in src/app/globals.css (@theme inline).
 *
 * Nothing brand-related is hardcoded in pages — change a value here and the
 * whole site updates. The simple monogram is served in SVG and PNG formats in /public/brand/.
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
    bg: "#0C0A0D",
    surface: "#19151B",
    elevated: "#251D26",
    overlay: "#302531",
    onGold: "#211216",
    // Text
    text: "#F8F2EE",
    textMuted: "#C2ADB5",
    // Lines
    line: "#493740",
    lineStrong: "#71515F",
    // Accents — gold is the accent, burgundy is for primary actions.
    // Sampled from the production StripClub logo artwork.
    gold: "#E76C78",
    goldSoft: "#F2A6AB",
    goldDeep: "#B92E45",
    burgundy: "#A61E38",
    burgundyDeep: "#5A1427",
    // Status
    success: "#74C297",
    danger: "#E5484D",
  },
  fonts: {
    display: "var(--font-playfair)", // headings / brand wordmark
    body: "var(--font-inter)", // body / UI
  },
  /** Logo asset paths — the only place file paths live. */
  logo: {
    favicon: "/brand/monogram-favicon.png",
    appleTouchIcon: "/brand/monogram-apple-touch.png",
    icon192: "/brand/monogram-icon-192.png",
    icon512: "/brand/monogram-icon-512.png",
    maskable: "/brand/monogram-maskable-512.png",
    mark: "/brand/monogram.svg",
  },
  pwa: {
    manifest: "/manifest.webmanifest",
    serviceWorker: "/sw.js",
    splashColor: "#0C0A0D",
    themeColor: "#0C0A0D",
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
    gold: "0 0 0 1px rgba(231, 108, 120, 0.22)",
    glow: "0 18px 45px rgba(0, 0, 0, 0.26)",
  },
} as const;

export type Brand = typeof brand;
