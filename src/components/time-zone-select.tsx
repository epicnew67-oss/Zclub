"use client";

import { useHydrated } from "@/hooks/use-hydrated";

const featured = ["Asia/Karachi", "Asia/Kolkata", "Asia/Dubai", "Asia/Dhaka", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Australia/Sydney", "Pacific/Auckland"];

export function TimeZoneSelect({ value, onChange, id, disabled }: { value: string; onChange: (zone: string) => void; id: string; disabled?: boolean }) {
  const hydrated = useHydrated();
  const zones = hydrated ? [...new Set([...featured, ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])].sort((a, b) => {
    const ai = featured.indexOf(a), bi = featured.indexOf(b);
    return ai >= 0 && bi >= 0 ? ai - bi : ai >= 0 ? -1 : bi >= 0 ? 1 : a.localeCompare(b);
  }) : featured;
  const device = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  return (
    <select id={id} name="time_zone" data-hydrated={hydrated} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !hydrated} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
      <option value="detect">Use my device time zone{device ? ` (${device})` : ""}</option>
      {value !== "detect" && !zones.includes(value) ? <option value={value}>{value.replaceAll("_", " ")}</option> : null}
      {zones.map((zone) => <option key={zone} value={zone}>{zone === "Asia/Karachi" ? "Pakistan — Karachi (PKT)" : zone.replaceAll("_", " ")}</option>)}
    </select>
  );
}

export function resolvedTimeZone(choice: string): string {
  return choice === "detect" ? Intl.DateTimeFormat().resolvedOptions().timeZone : choice;
}
