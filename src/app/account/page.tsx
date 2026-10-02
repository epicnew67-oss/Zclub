/* eslint-disable react-hooks/purity -- Async Server Component: time is evaluated per authenticated request, never in a client render. */
import type { Metadata } from "next";
import { CoinsIcon, BadgeCheckIcon, CalendarIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SellerApprovedAlert } from "@/components/seller/seller-approved-alert";
import { TimeZoneSettings } from "@/components/account/time-zone-settings";
import { ProfilePhotoEditor } from "@/components/account/profile-photo-editor";
import { isSafeImagePath } from "@/lib/safe-image-path";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard
          title="Almost there"
          subtitle="Supabase isn't configured — set your keys in .env.local."
        >
          <p className="text-sm text-muted-foreground">
            Protected pages unlock once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { supabase, user } = await requireUser("/account");

  const [profileResult, rolesResult, balanceResult, applicationResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url, is_banned, created_at, time_zone")
        .eq("id", user.id)
        .single(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
      supabase.rpc("get_own_wallet_balance"),
      supabase
        .from("seller_applications")
        .select("id, status, reviewed_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const application = applicationResult.data;
  const showSellerApprovedAlert =
    application?.status === "approved" &&
    application.reviewed_at &&
    Date.now() - new Date(application.reviewed_at).getTime() <
      30 * 24 * 60 * 60 * 1000;

  const email = user.email ?? "unknown";
  const displayName =
    profileResult.data?.display_name?.trim() || email.split("@")[0];
  const avatarPath = profileResult.data?.avatar_url;
  const avatarUrl = isSafeImagePath(avatarPath)
    ? (await supabase.storage.from("seller-avatars").createSignedUrl(avatarPath, 600)).data?.signedUrl ?? null
    : null;
  const roles = (rolesResult.data ?? []).map((row) => row.role);
  const balance =
    typeof balanceResult.data === "number" ? balanceResult.data : 0;
  const verified = Boolean(user.email_confirmed_at);
  const memberSince = profileResult.data?.created_at
    ? new Date(profileResult.data.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 md:px-8 md:py-16">
      {showSellerApprovedAlert && application ? (
        <SellerApprovedAlert applicationId={application.id} />
      ) : null}
      <header className="mb-8 border-b border-gold/25 pb-7">
        <p className="editorial-kicker">Your account / Profile</p>
        <h1 className="mt-4 font-heading text-5xl leading-none font-normal md:text-6xl">
          Your <em className="text-gold-soft">account.</em>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {email}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card variant="gold">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Your public presence on the marketplace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProfilePhotoEditor email={email} name={displayName} initialUrl={avatarUrl} />

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              {roles.map((role) => (
                <Badge
                  key={role}
                  variant={role === "owner" ? "default" : "outline"}
                  className="capitalize"
                >
                  {role}
                </Badge>
              ))}
              {verified ? (
                <Badge variant="success">
                  <BadgeCheckIcon data-icon="inline-start" />
                  Email verified
                </Badge>
              ) : (
                <Badge variant="destructive">Email unverified</Badge>
              )}
              {memberSince ? (
                <Badge variant="ghost">
                  <CalendarIcon data-icon="inline-start" />
                  Member since {memberSince}
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card variant="glow">
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
            <CardDescription>
              Your balance is the sum of your ledger — never a stored number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
                <CoinsIcon className="size-5 text-gold" />
              </div>
              <div>
                <div className="font-heading text-3xl font-semibold tabular-nums text-gold">
                  {balance.toLocaleString("en-US")}
                </div>
                <div className="text-xs text-muted-foreground">
                  tokens · 1 PKR = 2 tokens
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Token purchases and call earnings appear in your wallet.
            </p>
          </CardContent>
        </Card>
      </div>

      <TimeZoneSettings initialTimeZone={profileResult.data?.time_zone ?? null} />

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <Button asChild variant="ghost">
          <a href="/auth/forgot-password">Change password</a>
        </Button>
        <SignOutButton />
      </div>
    </div>
  );
}
