import type { Metadata } from "next";
import { CoinsIcon, BadgeCheckIcon, CalendarIcon } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SellerApprovedAlert } from "@/components/seller/seller-approved-alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "?";
  return source.slice(0, 2).toUpperCase();
}

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
        .select("display_name, avatar_url, is_banned, created_at")
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
  const roles = (rolesResult.data ?? []).map((row) => row.role);  const balance =
    typeof balanceResult.data === "number" ? balanceResult.data : 0;
  const verified = Boolean(user.email_confirmed_at);
  const memberSince = profileResult.data?.created_at
    ? new Date(profileResult.data.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 md:px-6 md:py-16">
      {showSellerApprovedAlert && application ? (
        <SellerApprovedAlert applicationId={application.id} />
      ) : null}
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold md:text-4xl">
          Your account
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
            <div className="flex items-center gap-4">
              <Avatar size="lg">
                <AvatarFallback className="bg-gold/15 text-gold">
                  {initials(displayName, email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {displayName}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {email}
                </p>
              </div>
            </div>

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
              Token packs and top-ups arrive with the wallet feature. Every
              change will be an append-only ledger entry.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <Button asChild variant="ghost">
          <a href="/auth/forgot-password">Change password</a>
        </Button>
        <SignOutButton />
      </div>
    </div>
  );
}
