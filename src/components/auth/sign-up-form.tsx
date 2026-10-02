"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CameraIcon, Loader2Icon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TimeZoneSelect, resolvedTimeZone } from "@/components/time-zone-select";
import { applyPendingSignupPhoto, rememberSignupPhoto, validateProfilePhoto } from "@/lib/profile-photo-client";

const MIN_PASSWORD = 8;

export function SignUpForm({ nextPath }: { nextPath: string }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timeZone, setTimeZone] = useState("detect");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // Honeypot — hidden field that real users won't fill in. Bots that
  // scan every input will populate it; we reject any submission that
  // does. Combined with the per-IP rate limit in proxy.ts this is the
  // cheap, dependency-free bot defence until Cloudflare Turnstile is
  // wired up.
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  function choosePhoto(file: File | null) {
    if (!file) return;
    const invalid = validateProfilePhoto(file);
    if (invalid) { setError(invalid); return; }
    setError(null);
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (website.trim().length > 0) {
      // Honeypot triggered — silently "succeed" without creating the
      // account so the bot doesn't retry with a different pattern.
      setSubmitting(true);
      await new Promise((r) => setTimeout(r, 400));
      window.location.assign("/auth/check-email");
      return;
    }

    if (displayName.trim().length < 2) {
      setError("Pick a display name (at least 2 characters).");
      return;
    }
    if (displayName.trim().length > 80) {
      setError("Display names max out at 80 characters.");
      return;
    }
    // Real email shape check (not just `includes("@")`). Local part
    // 1–64 chars, domain 1–255 chars, two-or-more labels, TLD >=2.
    if (
      !/^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}$/.test(
        email.trim(),
      )
    ) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Passwords need at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      if (photo) await rememberSignupPhoto(email, photo);
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim(), time_zone: resolvedTimeZone(timeZone) },
          emailRedirectTo: `${window.location.origin}/auth/check-email`,
        },
      });
      if (authError) {
        setSubmitting(false);
        setError(friendlyAuthError(authError.message));
        return;
      }

      // Email confirmation enabled: no session until the link is clicked.
      if (data.session) {
        if (photo) {
          try { await applyPendingSignupPhoto(email); } catch { /* Retry from the account page. */ }
        }
        window.location.assign(nextPath);
        return;
      }
      setSubmitting(false);
    } catch (err) {
      // Network-level failure — useful message instead of "Failed to fetch".
      setSubmitting(false);
      setError(friendlyAuthError(err instanceof Error ? err.message : null));
      return;
    }

    window.location.assign(
      `/auth/check-email${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t create your account</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Honeypot — visually hidden but reachable by automated bots.
          aria-hidden + tabIndex=-1 keeps keyboard / screen-reader users
          out of it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="sign-up-website">Website</label>
        <input
          id="sign-up-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sign-up-name">Display name</Label>
        <Input
          id="sign-up-name"
          name="display_name"
          autoComplete="nickname"
          placeholder="How others see you"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={submitting}
          required
          maxLength={80}
        />
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border/70 bg-surface/40 p-3">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-gold/40 bg-gold/10 text-gold">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="Profile photo preview" className="size-full object-cover" />
          ) : <CameraIcon className="size-6" aria-hidden="true" />}
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="sign-up-photo" className="cursor-pointer text-sm font-medium text-gold">Choose profile photo</Label>
          <Input id="sign-up-photo" type="file" accept="image/jpeg,image/png,image/webp" className="h-auto max-w-full text-xs" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} disabled={submitting} />
          <p className="text-xs text-muted-foreground">Optional · JPG, PNG, or WebP under 5 MB. It saves after you confirm your email and sign in on this device.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sign-up-email">Email</Label>
        <Input
          id="sign-up-email"
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
        <Label htmlFor="sign-up-password">Password</Label>
        <Input
          id="sign-up-password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          required
          minLength={MIN_PASSWORD}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sign-up-time-zone">Your region / time zone</Label>
        <TimeZoneSelect id="sign-up-time-zone" value={timeZone} onChange={setTimeZone} disabled={submitting} />
        <p className="text-xs text-muted-foreground">Calls will appear in this time zone. You can change it in your account later.</p>
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
            Creating account…
          </>
        ) : (
          "Create account"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already a member?{" "}
        <Link
          href={`/auth/sign-in${nextPath !== "/account" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          className="font-medium text-gold hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
