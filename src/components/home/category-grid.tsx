import Link from "next/link";
import { RevealSection } from "@/components/home/reveal-section";
import { MagicCard } from "@/components/magic-ui/magic-card";
import type { BrowseCategory } from "@/lib/browse";

export function CategoryGrid({ categories }: { categories: BrowseCategory[] }) {
  if (categories.length === 0) return null;
  return (
    <RevealSection
      target="[data-reveal]"
      className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14"
    >
      <div data-reveal className="mb-6 flex flex-col gap-1">
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          Browse by <span className="text-gold">category</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Find the kind of conversation you&apos;re looking for.
        </p>
      </div>
      <ul
        className="grid gap-3 sm:grid-cols-2 md:grid-cols-3"
        data-browse-grid
      >
        {categories.map((c) => (
          <li key={c.id} data-reveal>
            <MagicCard bare className="rounded-xl">
              <Link
                href={`/browse?category=${c.slug}`}
                className="group/cat flex items-center justify-between rounded-xl border border-gold/15 px-5 py-4 transition-colors hover:border-gold/45"
              >
                <span className="font-heading text-lg text-foreground transition-colors group-hover/cat:text-gold">
                  {c.name}
                </span>
                <span className="text-xs text-muted-foreground transition-all group-hover/cat:translate-x-1 group-hover/cat:text-gold">
                  →
                </span>
              </Link>
            </MagicCard>
          </li>
        ))}
      </ul>
    </RevealSection>
  );
}
