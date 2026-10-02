"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2Icon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { applyPendingSignupPhoto } from "@/lib/profile-photo-client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setSubmitting(false);

      if (authError) {
        const message = authError.message.toLowerCase();
        const status = (authError as { status?: number }).status;
        if (
          status === 429 ||
          message.includes("rate limit") ||
          message.includes("too many") ||
          message.includes("for security purposes")
        ) {
          // Supabase Auth enforces its own per-email/IP rate limit.
          // We never expose the raw message — show a friendly copy
          // with the retry-after window when we can read it.
          const retryAfter =
            (authError as { retryAfter?: number }).retryAfter ?? 30;
          setError(
            `Too many sign-in attempts. Please wait ${retryAfter} seconds, then try again.`
          );
        } else {
          setError(friendlyAuthError(authError.message));
        }
        return;
      }
      try { await applyPendingSignupPhoto(email); } catch { /* Account page retries the photo. */ }
    } catch (err) {
      // Network-level failures (offline, CSP, local stack down) throw
      // before supabase-js can wrap them — surface a useful message.
      setSubmitting(false);
      setError(friendlyAuthError(err instanceof Error ? err.message : null));
      return;
    }

    window.location.assign(nextPath);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t sign you in</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="sign-in-email">Email</Label>
        <Input
          id="sign-in-email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="sign-in-password">Password</Label>
          <Link
            href="/auth/forgot-password"
            className="text-xs text-muted-foreground transition-colors hover:text-gold"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="sign-in-password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={`/auth/sign-up${nextPath !== "/account" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          className="font-medium text-gold hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
