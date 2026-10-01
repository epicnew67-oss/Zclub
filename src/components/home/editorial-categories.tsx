"use client";

import { Marquee } from "@/components/magic-ui/marquee";

/**
 * EditorialCategories — horizontal strip of category names that
 * drifts continuously across the screen. Sits between the hero and
 * the FeaturedStrip as a tonal break: motion without distraction.
 *
 * Pattern adapted from magicui/marquee. Pauses on hover so the
 * reader can catch a name and follow it to /browse if they want.
 * Edge fades keep the start/end from looking like a hard cutoff.
 */
export function EditorialCategories({
  categories,
}: {
  categories: { id: string; name: string; slug: string }[];
}) {
  if (categories.length === 0) return null;

  return (
    <div className="border-y border-gold/10 bg-background/40 py-6 backdrop-blur-sm">
      <Marquee speed={42} className="text-muted-foreground/80">
        {categories.map((category) => (
          <a
            key={category.id}
            href={`/browse?category=${category.slug}`}
            className="group/cat whitespace-nowrap font-heading text-lg font-medium tracking-wide uppercase transition-colors hover:text-gold md:text-xl"
          >
            <span className="text-gold/40 mr-6 text-xs tracking-[0.3em]">·</span>
            {category.name}
          </a>
        ))}
      </Marquee>
    </div>
  );
}
