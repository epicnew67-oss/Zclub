"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { Logo } from "@/components/brand/Logo";

export type GalleryPhoto = {
  id: string;
  url: string | null;
  sort_order: number;
};

export function PhotoGallery({ photos }: { photos: GalleryPhoto[] }) {
  const sorted = [...photos].sort((a, b) => a.sort_order - b.sort_order);
  const [active, setActive] = useState(0);

  const next = useCallback(
    () => setActive((i) => (i + 1) % Math.max(sorted.length, 1)),
    [sorted.length]
  );
  const prev = useCallback(
    () => setActive((i) => (i - 1 + sorted.length) % Math.max(sorted.length, 1)),
    [sorted.length]
  );

  // Keyboard nav on the main photo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  if (sorted.length === 0) {
    return (
      <div
        className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-4 overflow-hidden border border-gold/25 bg-elevated"
        aria-label="No photos uploaded yet"
      >
        <Logo variant="mark" size="xl" className="opacity-70" />
        <span className="editorial-kicker">Private call / Preview to come</span>
      </div>
    );
  }

  const main = sorted[active];

  return (
    <div className="flex flex-col gap-3" data-gallery>
      <div
        className="relative aspect-[4/3] w-full overflow-hidden border border-gold/25 bg-surface/40"
        tabIndex={0}
        aria-roledescription="image carousel"
        aria-label={`Listing photo ${active + 1} of ${sorted.length}`}
      >
        {main.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={main.url}
            alt=""
            className="h-full w-full object-cover transition-opacity duration-300"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            ?
          </div>
        )}
        {sorted.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={prev}
              className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground/80 backdrop-blur hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={next}
              className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground/80 backdrop-blur hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRightIcon className="size-5" />
            </button>
            <span className="absolute right-3 bottom-3 rounded-full bg-background/85 px-2.5 py-0.5 text-[11px] text-foreground/80 backdrop-blur">
              {active + 1} / {sorted.length}
            </span>
          </>
        ) : null}
      </div>
      {sorted.length > 1 ? (
        <ul
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(sorted.length, 6)}, 1fr)` }}
        >
          {sorted.map((photo, i) => (
            <li key={photo.id}>
              <button
                type="button"
                data-gallery-thumb
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === active ? "true" : undefined}
                onClick={() => setActive(i)}
                className={cn(
                  "relative aspect-square w-full overflow-hidden rounded-sm border transition-colors duration-200",
                  i === active
                    ? "border-gold/80 shadow-gold"
                    : "border-border/70 hover:border-gold/40"
                )}
              >
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    ?
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
