"use client";

import { useLinkStatus } from "next/link";

export function ListingLinkFeedback() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-live="polite" className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 bg-background/90 p-4 backdrop-blur-sm"><span className="h-2/3 w-full animate-pulse rounded-lg bg-elevated" /><span className="h-5 w-3/4 animate-pulse rounded bg-elevated" /><span className="h-4 w-1/2 animate-pulse rounded bg-elevated" /></span> : null;
}
