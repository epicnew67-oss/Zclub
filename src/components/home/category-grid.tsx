import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { RevealSection } from "@/components/home/reveal-section";
import type { BrowseCategory } from "@/lib/browse";

export function CategoryGrid({ categories }: { categories: BrowseCategory[] }) {
  if (categories.length === 0) return null;

  return (
    <RevealSection target="[data-reveal]" className="editorial-light border-y border-gold/20">
      <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
        <div data-reveal className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div><p className="editorial-kicker">02 / Find your mood</p><h2 className="mt-3 font-heading text-4xl leading-none md:text-6xl">Explore by <em className="text-gold-soft">category.</em></h2></div>
          <p className="max-w-xs text-sm leading-6 text-muted-foreground">Find a call that suits the conversation you want to have.</p>
        </div>
        <ul className="grid border-t border-gold/25 md:grid-cols-2" data-browse-grid>
          {categories.map((category, index) => (
            <li key={category.id} data-reveal className="border-b border-gold/25 md:odd:border-r">
              <Link href={`/browse?category=${category.slug}`} className="group flex min-h-24 items-center gap-5 px-3 py-5 transition-colors hover:bg-gold/5 md:px-6">
                <span className="self-start pt-1 text-[10px] font-semibold tracking-[.16em] text-gold">{String(index + 1).padStart(2, "0")}</span>
                <span className="font-heading text-2xl leading-tight text-foreground transition-colors group-hover:text-gold-soft md:text-3xl">{category.name}</span>
                <ArrowUpRightIcon className="ml-auto size-5 shrink-0 text-gold transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </RevealSection>
  );
}
