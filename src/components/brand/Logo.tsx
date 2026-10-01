import { brand } from "@/lib/brand";
import { cn } from "cn";

type LogoProps = {
  /** full = mark + wordmark (horizontal), mark = SC monogram only, wordmark = text only */
  variant?: "full" | "mark" | "wordmark";
  /** dark-on-gold version for use on gold backgrounds */
  invert?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
};

const sizes = {
  sm: { mark: 28, word: 14 },
  md: { mark: 36, word: 16 },
  lg: { mark: 56, word: 22 },
  xl: { mark: 96, word: 32 },
  "2xl": { mark: 160, word: 56 },
} as const;

/**
 * The ONE logo component. Inline SVG so it renders crisply at every size
 * and inherits colors from `brand.colors` (the only place brand values
 * live). The mark is an interlocked burgundy C + gold S with a gold
 * accent line set into the C's opening.
 *
 * Every place that shows a logo must use this component — never hardcode
 * the name, a path, or an image elsewhere. The /public/brand/*.svg app
 * icons mirror these exact paths with literal colors.
 *
 * === Mark design (V4) ===
 *
 * Three SVG primitives in a 64×64 viewBox:
 *
 *   1. Burgundy C — a single 270° arc (radius 18, stroke 8). Single
 *      stroke only; no rim / double-stroke technique. Renders ≈3px on
 *      a 24px favicon, which is the smallest size that still reads as
 *      a clean C against the near-black navbar background.
 *
 *   2. Gold S — the same interlocked letterform, stroke 7 (one unit
 *      lighter than the C). One unit of contrast is enough to give
 *      the two letters clear "C contains S" hierarchy without making
 *      the S disappear at favicon size — bigger weight gaps start to
 *      look unbalanced at hero size.
 *
 *   3. Gold accent line — vertical line at x=44 (between the S's
 *      rightmost extent at x≈41 and the C's inner edge at x≈46).
 *      x=44 was chosen over the V3 x=51 because x=51 sat at the
 *      viewBox edge and got cropped at favicon sizes + by OS masks
 *      that round the icon. Stroke 3.5 (thicker than V3's 2.5) so
 *      it renders ≈1.3px on a 24px favicon — just visible on 1×
 *      displays, clearly visible on retina.
 *
 * Variations explored and rejected:
 *   V3 (previous) — burgundy C with a 1-unit gold hairline rim
 *     (stroke 10 gold behind stroke 8 burgundy on the same path) +
 *     S stroke 6 + accent at x=51 stroke 2.5. The rim was meant to
 *     keep the burgundy band legible against near-black at small
 *     sizes, but the 2-unit difference merges into a single band at
 *     24px anyway, and the accent at x=51 got clipped by OS masks.
 *
 *   V4-B "hairline halo" — outer 2px gold ring + chunky C. The halo
 *     disappears entirely at favicon size (2/64 × 24 = 0.75px,
 *     sub-pixel) — defeats the purpose of the halo.
 *
 *   V4-C "equal weight" — both letters at stroke 7. The letters
 *     carry similar visual weight and read ambiguously as "SC" vs
 *     "CS" at small sizes.
 */
export function Logo({
  variant = "full",
  invert = false,
  size = "md",
  className,
}: LogoProps) {
  const s = sizes[size];
  const gold = invert ? brand.colors.bg : brand.colors.gold;
  const burgundy = invert ? brand.colors.bg : brand.colors.burgundy;
  const wordFill = invert ? brand.colors.bg : brand.colors.gold;
  const markWidth = s.mark;
  const markHeight = s.mark;

  return (
    <span
      aria-label={brand.name}
      data-logo={variant}
      data-invert={invert ? "true" : undefined}
      className={cn(
        "inline-flex select-none items-center",
        variant === "full" ? "gap-3" : "gap-0",
        className,
      )}
    >
      {variant !== "wordmark" ? (
        <svg
          data-logo-mark
          width={markWidth}
          height={markHeight}
          viewBox="0 0 64 64"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          {/* Burgundy C — single 270° arc, gap on the right. Drawn
              first so the S + accent layer on top. */}
          <path
            d="M 49.4 27.3 A 18 18 0 1 0 49.4 36.7"
            stroke={burgundy}
            strokeWidth={8}
          />
          {/* Gold S — interlocked inside the C. One unit lighter than
              the C for clear "C contains S" hierarchy. */}
          <path
            d="M 38.5 20.5
               C 34 16.5 23.5 16.5 22.5 23.5
               C 21.8 28.5 27 31.2 32 32.6
               C 39 34.4 41 37.8 40 41.6
               C 38.7 47.3 26.5 48.6 22.5 43.5"
            stroke={gold}
            strokeWidth={7}
          />
          {/* Gold accent line — set into the C's opening at x=44,
              between the S's rightmost extent and the C's inner edge.
              Stroke 3.5 (≈1.3px on a 24px favicon) so it survives at
              small sizes and isn't clipped by OS rounded masks. */}
          <line
            x1={44}
            y1={24}
            x2={44}
            y2={40}
            stroke={gold}
            strokeWidth={3.5}
          />
        </svg>
      ) : null}
      {variant !== "mark" ? (
        (() => {
          // Explicit numeric width/height — SVG has no valid "auto"
          // attribute, and the browser logs "Expected length, auto"
          // when one is present. Compute the rendered box from the
          // viewBox aspect so the wordmark scales exactly.
          const viewW = brand.name.length * s.word * 0.9;
          const viewH = s.word * 1.4;
          const renderH = Math.round(s.word * 1.2);
          const renderW = Math.round((viewW * renderH) / viewH);
          return (
            <svg
              data-logo-word
              width={renderW}
              height={renderH}
              viewBox={`0 0 ${viewW} ${viewH}`}
              role="img"
              aria-hidden="true"
              className="shrink-0"
            >
              <text
                x="50%"
                y="62%"
                textAnchor="middle"
                fontFamily={`${brand.fonts.display}, 'Playfair Display', Georgia, serif`}
                fontWeight={500}
                fontSize={s.word}
                letterSpacing={s.word * 0.28}
                fill={wordFill}
              >
                {brand.name.toUpperCase()}
              </text>
            </svg>
          );
        })()
      ) : null}
    </span>
  );
}
