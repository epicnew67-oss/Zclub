"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { cn } from "cn";
import type { BrowseSlot } from "@/lib/browse";
import { upperMeridiem } from "@/lib/datetime-format";

function formatLocalDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  return upperMeridiem(
    d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
}

export function SlotsPicker({ slots }: { slots: BrowseSlot[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("slot");

  const select = useCallback(
    (slotId: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (slotId) sp.set("slot", slotId);
      else sp.delete("slot");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      if (slotId) {
        // Bring the buy panel (price + Reserve) into view so the next
        // step is obvious.
        setTimeout(() => {
          document
            .querySelector("[data-buy-panel]")
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 120);
      }
    },
    [params, pathname, router]
  );

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-gold/20 bg-surface/40 px-5 py-8 text-center">
        <p className="font-heading text-base text-foreground">No upcoming slots</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The seller hasn&apos;t published any open times yet. Check back soon.
        </p>
      </div>
    );
  }

  // Group by local date.
  const groups = new Map<string, BrowseSlot[]>();
  for (const slot of slots) {
    const key = formatLocalDay(slot.starts_at);
    const arr = groups.get(key) ?? [];
    arr.push(slot);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-4" data-slots>
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl text-foreground">Available slots</h2>
        {selectedId ? (
          <button
            type="button"
            onClick={() => select(null)}
            className="text-xs text-muted-foreground hover:text-gold"
          >
            Clear selection
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {Array.from(groups.entries()).map(([day, daySlots]) => (
          <div
            key={day}
            className="rounded-xl border border-gold/20 bg-surface/40 px-4 py-3"
          >
            <p className="mb-2 text-[10px] tracking-wider uppercase text-muted-foreground">
              {day}
            </p>
            <ul className="flex flex-wrap gap-2">
              {daySlots.map((slot) => {
                const isSelected = slot.id === selectedId;
                return (
                  <li key={slot.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => select(isSelected ? null : slot.id)}
                      title={isSelected ? "Click to unselect" : "Click to select"}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm transition-all duration-200",
                        isSelected
                          ? "border-gold bg-gold/15 text-gold shadow-gold"
                          : "border-border/70 bg-background/40 text-foreground/80 hover:border-gold/40 hover:text-gold"
                      )}
                    >
                      {formatLocalTime(slot.starts_at)} – {formatLocalTime(slot.ends_at)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}