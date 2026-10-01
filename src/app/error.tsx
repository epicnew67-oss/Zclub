"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Root error boundary — replaces Next's raw "This page couldn't load"
 * screen with a branded retry card. Catches render errors from any route
 * below the root layout (navbar/footer stay mounted).
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-border/70 bg-surface/40 p-6 text-center">
        <h1 className="font-heading text-xl font-semibold">
          Something went <span className="text-gold">wrong</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page hit a snag{error.digest ? ` (${error.digest})` : ""}. Try
          again — if it keeps happening, reload the page.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button onClick={reset} className="shadow-gold">
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
