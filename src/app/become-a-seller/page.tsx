import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { getSellerStatus, getSellerTermsVersion } from "@/lib/seller";
import { SellerApplicationForm } from "@/components/seller/seller-application-form";
import { isSafeImagePath } from "@/lib/safe-image-path";

export const metadata: Metadata = { title: "Become a seller" };

function formatCooldown(reviewedAt: string | null) {
  if (!reviewedAt) return null;
  const cooldownEnd = new Date(new Date(reviewedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  if (cooldownEnd <= new Date()) return null;
  return cooldownEnd.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BecomeASellerPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Become a seller" subtitle="Sellers need a configured Supabase — set .env.local.">
          <p className="text-sm text-muted-foreground">The seller flow unlocks once Supabase is configured.</p>
        </AuthCard>
      </div>
    );
  }

  const { user, supabase } = await requireUser("/become-a-seller");
  const [status, termsVersion] = await Promise.all([
    getSellerStatus(user.id),
    getSellerTermsVersion(),
  ]);

  // Already a seller → shortcut to the dashboard.
  if (status.isSeller) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-6 md:py-16">
        <AuthCard title="You're already a seller" subtitle="Your seller profile is live.">
          <p className="text-sm text-muted-foreground">
            You&apos;re live as <span className="font-medium text-foreground">{status.slug ?? "seller"}</span>. Manage your dashboard below.
          </p>
          <div className="mt-4">
            <a href="/seller" className="text-sm font-medium text-gold hover:underline">Go to seller dashboard →</a>
          </div>
        </AuthCard>
      </div>
    );
  }

  const pending = status.applications.find((a) => a.status === "pending");
  if (pending) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-6 md:py-16">
        <div className="pointer-events-none absolute -top-24 right-8 h-64 w-64 rounded-full bg-burgundy/15 blur-3xl" aria-hidden />
        <AuthCard title="Application pending" subtitle="We&apos;re reviewing your seller application.">
          <p className="text-sm text-muted-foreground">
            Submitted {(pending.created_at && new Date(pending.created_at).toLocaleString()) ?? ""} as
            <span className="font-medium text-foreground"> {pending.display_name}</span>. You&apos;ll be notified when a decision is made. One pending application at a time.
          </p>
          {pending.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pending.avatar_url} alt="Profile" className="mt-4 h-20 w-20 rounded-2xl border border-gold/20 object-cover" />
          ) : null}
        </AuthCard>
      </div>
    );
  }

  const latestRejected = status.applications
    .filter((a) => a.status === "rejected")
    .sort((a, b) => new Date(b.reviewed_at ?? b.created_at).getTime() - new Date(a.reviewed_at ?? a.created_at).getTime())[0] ?? null;

  const cooldownUntil = latestRejected ? formatCooldown(latestRejected.reviewed_at) : null;
  const rejectedNote = latestRejected?.review_note ?? null;
  const attemptsUsed = status.applications.length;
  const maxAttemptsReached = attemptsUsed >= 3 && (!latestRejected || latestRejected.status === "rejected" || attemptsUsed >= 3);
  const isBlockedByCooldown = Boolean(cooldownUntil);
  const isBlockedByAttempts = attemptsUsed >= 3;

  if (isBlockedByAttempts) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-6 md:py-16">
        <AuthCard title="Application limit reached" subtitle="You&apos;ve used all 3 seller applications.">
          <p className="text-sm text-muted-foreground">Contact support if you believe this is an error.</p>
          {rejectedNote ? (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Last decision: {rejectedNote}
            </div>
          ) : null}
        </AuthCard>
      </div>
    );
  }

  if (isBlockedByCooldown && cooldownUntil) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-6 md:py-16">
        <AuthCard title="Reapply cooldown" subtitle={`You can reapply on ${cooldownUntil}.`}>
          <p className="text-sm text-muted-foreground">Our review team asked for a 7-day waiting period after the last decision.</p>
          {rejectedNote ? (
            <div className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
              Feedback: {rejectedNote}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">Attempts used: {attemptsUsed} of 3.</p>
        </AuthCard>
      </div>
    );
  }

  const { data: accountProfile } = await supabase.from("profiles")
    .select("display_name, avatar_url").eq("id", user.id).maybeSingle();
  const accountAvatarPath = isSafeImagePath(accountProfile?.avatar_url) ? accountProfile.avatar_url : null;
  const accountAvatarUrl = accountAvatarPath
    ? (await supabase.storage.from("seller-avatars").createSignedUrl(accountAvatarPath, 600)).data?.signedUrl ?? null
    : null;

  return (
    <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-hidden px-4 py-10 md:px-6 md:py-16">
      <div aria-hidden className="pointer-events-none absolute -top-24 right-2 h-72 w-72 rounded-full bg-burgundy/15 blur-3xl" />
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">Become a seller</h1>
        <p className="max-w-prose text-sm text-muted-foreground">Upload a profile picture, tell buyers who you are, and agree to the community rules. We review most applications within a day.</p>
        {attemptsUsed > 0 ? (
          <p className="text-xs text-muted-foreground">Attempts used: {attemptsUsed} of 3{rejectedNote ? " · last review below" : ""}.</p>
        ) : null}
        {rejectedNote ? (
          <div className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
            <span className="font-medium text-gold">Last decision:</span> <span className="text-foreground">{rejectedNote}</span>
          </div>
        ) : null}
      </div>

      <SellerApplicationForm
        termsVersion={termsVersion}
        defaultDisplayName={attemptsUsed > 0 ? (status.applications[0]?.display_name ?? "") : accountProfile?.display_name ?? ""}
        defaultAvatarPath={accountAvatarPath}
        defaultAvatarUrl={accountAvatarUrl}
      />
    </div>
  );
}
