"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheckIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Pops once for a seller whose onboarding request was just accepted
 * (same alert-strip pattern as watermelon's alert-13, styled for the
 * STRIPCLUB dark/gold look). Rendered in SSR so it appears instantly;
 * the layout effect hides it before paint when already acknowledged
 * (remembered per application in localStorage) — no flash, no nagging.
 */
export function SellerApprovedAlert({ applicationId }: { applicationId: string }) {
  const storageKey = `sc-seller-approved-ack:${applicationId}`;
  const [visible, setVisible] = useState(true);

  useIsomorphicLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey)) setVisible(false);
    } catch {
      // storage blocked — keep showing it
    }
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore — the alert simply shows again next visit
    }
    setVisible(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-in fade-in slide-in-from-bottom-4 fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md duration-300 md:inset-x-auto md:right-6 md:bottom-6 md:mx-0"
    >
      <Alert className="border-gold/40 bg-surface/95 shadow-glow backdrop-blur">
        <BadgeCheckIcon className="text-gold" />
        <AlertTitle className="text-sm">
          Your seller onboarding was accepted — welcome aboard!
        </AlertTitle>
        <AlertAction className="top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-gold hover:bg-gold/10"
          >
            <Link href="/seller/listings/new" onClick={dismiss}>
              Open
            </Link>
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </AlertAction>
      </Alert>
    </div>
  );
}
