/* eslint-disable react-hooks/purity -- Async Server Component: time is evaluated per authenticated request, never in a client render. */
import type { Metadata } from "next";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSellerStatus } from "@/lib/seller";
import { listSellerListings } from "@/lib/listings";
import { SellerApprovedAlert } from "@/components/seller/seller-approved-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Seller dashboard" };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  unpublished: "Unpublished",
};

export default async function SellerDashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to use the seller dashboard.
        </p>
      </div>
    );
  }

  const { user } = await requireUser("/seller");
  const supabase = await createClient();
  const { data: hasSeller } = await supabase.rpc("user_has_role", { _role: "seller" });
  const { data: application } = await supabase
    .from("seller_applications")
    .select("id, status, reviewed_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hasPending = application?.status === "pending";

  if (!hasSeller && !hasPending) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Only approved sellers can access the dashboard.{" "}
          <Link href="/become-a-seller" className="font-medium text-gold hover:underline">
            Apply to become a seller →
          </Link>
        </p>
      </div>
    );
  }
  if (!hasSeller && hasPending) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-sm text-muted-foreground">
          Your seller application is under review. Revisit{" "}
          <Link href="/become-a-seller" className="font-medium text-gold hover:underline">
            /become-a-seller
          </Link>{" "}
          for status.
        </p>
      </div>
    );
  }

  const [status, balanceResult] = await Promise.all([
    getSellerStatus(user.id),
    supabase.rpc("get_own_wallet_balance"),
  ]);

  const { data: profileRow } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const listings = profileRow ? await listSellerListings(profileRow.id) : [];

  const slug = status.slug;
  const counts = listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});
  const balance = typeof balanceResult === "number" ? balanceResult : 0;

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <div aria-hidden className="pointer-events-none absolute -top-24 right-4 h-72 w-72 rounded-full bg-burgundy/15 blur-3xl" />
      {application?.status === "approved" &&
      application.reviewed_at &&
      Date.now() - new Date(application.reviewed_at).getTime() <
        30 * 24 * 60 * 60 * 1000 ? (
        <SellerApprovedAlert applicationId={application.id} />
      ) : null}
      <div>
        <Badge variant="gold-outline">Seller</Badge>
        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-foreground">
          Seller dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome, <span className="font-medium text-foreground">{slug ?? "seller"}</span> — your seller profile is live.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="gold">
          <CardHeader>
            <CardTitle className="text-gold">Listings</CardTitle>
            <CardDescription>Status counts across your catalog.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(["draft", "pending_review", "approved", "rejected", "unpublished"] as const).map(
              (s) => (
                <div key={s} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{STATUS_LABELS[s]}</span>
                  <span className="font-medium text-foreground">{counts[s] ?? 0}</span>
                </div>
              )
            )}
            <div className="pt-2">
              <Button asChild size="sm" className="bg-burgundy text-foreground hover:bg-burgundy/90">
                <Link href="/seller/listings">Manage listings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card variant="glow">
          <CardHeader>
            <CardTitle className="text-foreground">Wallet</CardTitle>
            <CardDescription>Your token balance — buyers pay you in tokens.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl text-gold">{balance.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">tokens</p>
            <div className="mt-3">
              <Button asChild size="sm" variant="outline">
                <Link href="/wallet">Open wallet</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>Set up your listings and profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Create a listing, upload up to 6 photos, and submit it for admin review. Once approved,
              buyers can book while you are online and not in a call.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" className="bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow">
                <Link href="/seller/listings/new">New listing</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/seller/profile">Edit profile</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
