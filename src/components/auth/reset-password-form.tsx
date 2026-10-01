"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Phase = "checking" | "need-link" | "ready" | "submitting" | "done";

const MIN_PASSWORD = 8;

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const exchanged = useRef(false);

  // Recovery links land here with ?code=... — exchange it for a session.
  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const code = searchParams.get("code");
    const supabase = createClient();

    (async () => {
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError("This reset link is invalid or already used. Request a new one.");
          setPhase("need-link");
          return;
        }
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setPhase(user ? "ready" : "need-link");
    })();
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Passwords need at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setPhase("submitting");
    const supabase = createClient();
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(friendlyAuthError(updateError.message));
        setPhase("ready");
        return;
      }
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : null));
      setPhase("ready");
      return;
    }

    setPhase("done");
    window.location.assign("/account");
  }

  if (phase === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Checking your reset link…
      </div>
    );
  }

  if (phase === "need-link") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>No active reset session</AlertTitle>
          <AlertDescription>
            {error ??
              "Open the reset link from your email, then set a new password here."}
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <a href="/auth/forgot-password">Request a new link</a>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t reset your password</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={phase !== "ready"}
          required
          minLength={MIN_PASSWORD}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          placeholder="Repeat it"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={phase !== "ready"}
          required
          minLength={MIN_PASSWORD}
        />
      </div>

      <Button type="submit" className="w-full" disabled={phase !== "ready"}>
        {phase === "submitting" ? (
          <>
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
            Saving…
          </>
        ) : (
          "Set new password"
        )}
      </Button>
    </form>
  );
}
