import { brand } from "@/lib/brand";

/**
 * Server component that renders the brand tokens from src/lib/brand.ts as
 * runtime CSS variables on :root. Placed first inside <body> so it is emitted
 * after the stylesheet link and overrides the static fallbacks declared in
 * globals.css.
 */
export function BrandStyle() {
  const c = brand.colors;
  const vars: Record<string, string> = {
    // shadcn semantic tokens
    "--background": c.bg,
    "--foreground": c.text,
    "--card": c.surface,
    "--card-foreground": c.text,
    "--popover": c.overlay,
    "--popover-foreground": c.text,
    "--primary": c.burgundy, // burgundy drives primary actions
    "--primary-foreground": c.text,
    "--secondary": c.burgundyDeep,
    "--secondary-foreground": c.text,
    "--muted": c.elevated,
    "--muted-foreground": c.textMuted,
    "--accent": c.overlay,
    "--accent-foreground": c.goldSoft,
    "--destructive": c.danger,
    "--border": c.line,
    "--input": c.lineStrong,
    "--ring": c.gold,
    "--radius": brand.radius.base,
    // brand-native tokens
    "--gold": c.gold,
    "--gold-soft": c.goldSoft,
    "--gold-deep": c.goldDeep,
    "--burgundy": c.burgundy,
    "--burgundy-deep": c.burgundyDeep,
    "--success": c.success,
    "--shadow-soft": brand.shadows.soft,
    "--shadow-gold": brand.shadows.gold,
    "--shadow-glow": brand.shadows.glow,
  };

  const css = `:root{${Object.entries(vars)
    .map(([key, value]) => `${key}:${value};`)
    .join("")}}`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
