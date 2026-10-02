import Image from "next/image";
import { cn } from "cn";
import { brand } from "@/lib/brand";

type LogoProps = {
  variant?: "full" | "mark" | "wordmark";
  invert?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
};

const sizes = {
  sm: { mark: 29, word: 14 },
  md: { mark: 37, word: 17 },
  lg: { mark: 55, word: 23 },
  xl: { mark: 94, word: 34 },
  "2xl": { mark: 160, word: 56 },
} as const;

/** The crest is isolated from the owner's supplied logo art. */
export function Logo({ variant = "full", invert = false, size = "md", className }: LogoProps) {
  const { mark, word } = sizes[size];

  return (
    <span
      aria-label={brand.name}
      data-logo={variant}
      data-invert={invert ? "true" : undefined}
      className={cn("inline-flex select-none items-center", variant === "full" && "gap-2.5", className)}
    >
      {variant !== "wordmark" ? (
        <Image
          data-logo-mark
          src={brand.logo.mark}
          alt=""
          loading="eager"
          width={410}
          height={495}
          className={cn("shrink-0 object-contain", invert && "brightness-0")}
          style={{ width: mark, height: Math.round(mark * 495 / 410) }}
        />
      ) : null}
      {variant !== "mark" ? (
        <span
          data-logo-word
          aria-hidden="true"
          className={cn("font-heading font-medium leading-none tracking-[.14em] whitespace-nowrap", invert ? "text-background" : "text-gold-soft")}
          style={{ fontSize: word }}
        >
          {brand.name.toUpperCase()}
        </span>
      ) : null}
    </span>
  );
}
