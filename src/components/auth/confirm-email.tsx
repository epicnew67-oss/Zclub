"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, MailCheckIcon, CircleCheckIcon, CircleAlertIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "confirming" | "done" | "error";

/**
 * Confirmation landing. Supabase's confirmation link redirects back here
 * with `?code=...` (PKCE). That code must be exchanged for a session —
 * otherwise the user is never signed in after clicking the link. The
 * exchange uses the PKCE verifier cookie stored by the browser client
 * when sign-up was initiated, so it works in the same browser.
 */
export function ConfirmEmail({
  code,
  address,
}: {
  code: string | null;
  address: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(code ? "confirming" : "idle");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!code) return; // plain "check your email" info state

    const supabase = createClient();
    (async () => {
      try {
        // Already signed in (e.g. link clicked twice)? Go straight in.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          router.replace("/account");
          return;
        }

        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(friendlyAuthError(exchangeError.message));
          setPhase("error");
          return;
        }

        setPhase("done");
        router.replace("/account");
        router.refresh();
      } catch (err) {
        setError(friendlyAuthError(err instanceof Error ? err.message : null));
        setPhase("error");
      }
    })();
  }, [code, router]);

  if (phase === "confirming") {
    return (
      <AuthCard
        title="Confirming your email"
        subtitle="One moment while we finish setting up your account."
      >
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Confirming your email…
        </div>
      </AuthCard>
    );
  }

  if (phase === "done") {
    return (
      <AuthCard title="Email confirmed" subtitle="Signing you in…">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-success/40 bg-success/10">
            <CircleCheckIcon className="size-6 text-success" />
          </div>
          <p className="text-sm text-muted-foreground">
            Your email is confirmed. Taking you to your account…
          </p>
        </div>
      </AuthCard>
    );
  }

  if (phase === "error") {
    return (
      <AuthCard
        title="Link couldn't be confirmed"
        subtitle="The confirmation link is invalid or was already used."
      >
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10">
            <CircleAlertIcon className="size-6 text-destructive" />
          </div>
          <p className="text-sm text-muted-foreground">
            {error ??
              "If you already confirmed your email, just sign in with your email and password."}
          </p>
          <Button asChild className="w-full bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Check your email"
      subtitle="We sent you a confirmation link to finish setting up your account."
    >
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
          <MailCheckIcon className="size-6 text-gold" />
        </div>
        {address ? (
          <p className="text-sm">
            <span className="font-medium text-foreground">{address}</span>
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Open the link in this browser and it signs you in automatically —
          it confirms your address at the same time. If you open it on a
          different device, your email is still confirmed; just sign in below.
        </p>
        <p className="text-xs text-muted-foreground">
          Local development: emails land in Mailpit at{" "}
          <a
            href="http://localhost:54324"
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline"
          >
            localhost:54324
          </a>
          .
        </p>
        <Button asChild variant="outline">
          <Link href="/auth/sign-in">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
