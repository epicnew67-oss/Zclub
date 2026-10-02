"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { upperMeridiem } from "@/lib/datetime-format";

export function LocalDateTime({ value }: { value: string }) {
  const hydrated = useHydrated();
  const text = new Date(value).toLocaleString(hydrated ? undefined : "en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric",
    minute: "2-digit", hour12: true, timeZone: hydrated ? undefined : "UTC",
    timeZoneName: "short",
  });
  return <time dateTime={value}>{upperMeridiem(text)}</time>;
}
