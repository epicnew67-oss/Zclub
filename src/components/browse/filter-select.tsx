"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Tiny client wrapper around a native <select> that mirrors its value
 * into the URL on change. Lets the toolbar stay server-rendered for
 * the initial paint while still driving a server re-fetch.
 */
export function FilterSelect({
  param,
  initial,
  options,
  ariaLabel,
}: {
  param: string;
  initial: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next && next !== options[0]?.value) sp.set(param, next);
    else sp.delete(param);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <select
      value={initial || options[0]?.value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="flex h-10 rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}