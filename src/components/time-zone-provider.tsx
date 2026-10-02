"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";

const TimeZoneContext = createContext<string | null>(null);

export function TimeZoneProvider({ value, children }: { value: string | null; children: ReactNode }) {
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

export function useDisplayTimeZone(): string {
  const saved = useContext(TimeZoneContext);
  const hydrated = useHydrated();
  return saved || (hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
}
