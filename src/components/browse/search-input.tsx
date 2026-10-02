"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Debounced search input that mirrors its value into the URL via
 * router.replace. Keeps the server-rendered toolbar cheap while still
 * giving the user immediate feedback. 250ms debounce matches the
 * "input → URL → server re-fetch" round-trip budget.
 */
export function SearchInput({
  initial,
  className,
}: {
  initial: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = params.get("q") ?? "";
  const [previousQuery, setPreviousQuery] = useState(query);
  if (query !== previousQuery) {
    setPreviousQuery(query);
    setValue(query);
  }

  // Cancel pending work on navigation/unmount as well as when clearing.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [params]);

  function commit(next: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const sp = new URLSearchParams(params.toString());
    if (next.trim()) sp.set("q", next.trim());
    else sp.delete("q");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(next), 250);
  }

  return (
    <div className={`relative flex items-center ${className ?? ""}`}>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by title…"
        aria-label="Search listings"
        className="h-10 pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            commit("");
          }}
          className="absolute right-2 grid size-6 place-items-center rounded text-muted-foreground hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
