import { SearchInput } from "@/components/browse/search-input";
import { FilterSelect } from "@/components/browse/filter-select";
import type { BrowseCategory, BrowseSort } from "@/lib/browse";

const SORT_OPTIONS: { value: BrowseSort | ""; label: string }[] = [
  { value: "", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export function BrowseToolbar({
  initialSearch,
  initialCategorySlug,
  initialSort,
  categories,
  resultCount,
}: {
  initialSearch: string;
  initialCategorySlug: string;
  initialSort: BrowseSort;
  categories: BrowseCategory[];
  resultCount: number | null;
}) {
  const categoryOptions = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.slug, label: c.name })),
  ];

  return (
    <div
      data-toolbar
      className="flex flex-col gap-3 rounded-xl border border-gold/20 bg-surface/60 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <SearchInput initial={initialSearch} className="flex-1 sm:max-w-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          param="category"
          initial={initialCategorySlug}
          options={categoryOptions}
          ariaLabel="Filter by category"
        />
        <FilterSelect
          param="sort"
          initial={initialSort}
          options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          ariaLabel="Sort listings"
        />
      </div>
      <p
        className="text-xs text-muted-foreground sm:text-right"
        aria-live="polite"
      >
        {resultCount === null
          ? "Loading…"
          : resultCount === 0
            ? "No matches"
            : `${resultCount.toLocaleString()} listing${resultCount === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
