import { cn } from "cn";
import { brand } from "@/lib/brand";

type LogoProps = {
  variant?: "full" | "mark" | "wordmark";
  invert?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
};

const sizes = {
  sm: { mark: "size-8 text-[27px]", word: "text-[15px]" },
  md: { mark: "size-10 text-[34px]", word: "text-[19px]" },
  lg: { mark: "size-14 text-[48px]", word: "text-[25px]" },
  xl: { mark: "size-24 text-[80px]", word: "text-[39px]" },
  "2xl": { mark: "size-36 text-[116px]", word: "text-[58px]" },
} as const;

/** A simple letterform replaces the overlapping crest in the old artwork. */
export function Logo({ variant = "full", invert = false, size = "md", className }: LogoProps) {
  const scale = sizes[size];
  return (
    <span
      aria-label={brand.name}
      data-logo={variant}
      className={cn("inline-flex select-none items-center", variant === "full" && "gap-2.5", className)}
    >
      {variant !== "wordmark" ? (
        <span
          data-logo-mark
          aria-hidden="true"
          className={cn("relative grid shrink-0 place-items-center overflow-hidden border font-heading italic leading-none", invert ? "border-background/40 bg-background text-foreground" : "border-gold/50 bg-burgundy text-foreground", scale.mark)}
        >
          <span className="-translate-y-[.04em]">S</span>
          <span className={cn("absolute right-0 bottom-0 h-[3px] w-1/2", invert ? "bg-foreground" : "bg-gold-soft")} />
        </span>
      ) : null}
      {variant !== "mark" ? (
        <span data-logo-word aria-hidden="true" className={cn("font-heading leading-none font-semibold tracking-[-.035em] whitespace-nowrap", scale.word)}>
          <span className={invert ? "text-background" : "text-foreground"}>STRIP</span><span className={invert ? "text-background/65" : "text-gold-soft"}>CLUB</span>
        </span>
      ) : null}
    </span>
  );
}
