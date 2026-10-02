import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listSellerListings, type ListingStatus } from "@/lib/listings";
import { SubmitListingButton } from "@/components/seller/submit-listing-button";
import { ArchiveListingButton } from "@/components/seller/archive-listing-button";
import { ListingVisibilityButton } from "@/components/seller/listing-visibility-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  unpublished: "Unpublished",
};

const STATUS_VARIANTS: Record<ListingStatus, "default" | "secondary" | "destructive" | "success" | "outline" | "gold-outline"> = {
  draft: "outline",
  pending_review: "default",
  approved: "success",
  rejected: "destructive",
  unpublished: "secondary",
};

export default async function SellerListingsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="px-4 py-10 md:px-6 md:py-12">
        <p className="text-sm text-muted-foreground">
          Configure Supabase in .env.local to view listings.
        </p>
      </div>
    );
  }

  const { user } = await requireUser("/seller/listings");
  const supabase = await createClient();
  const { data: profileRow } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profileRow) {
    return (
      <div className="px-4 py-10 md:px-6 md:py-12">
        <p className="text-sm text-muted-foreground">
          Only approved sellers can view listings.
        </p>
      </div>
    );
  }

  const listings = await listSellerListings(profileRow.id);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            <span className="text-gold">Listings</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a listing, upload photos, and submit it for review. First listing always needs admin approval.
          </p>
        </div>
        <Button
          asChild
          className="bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow"
        >
          <Link href="/seller/listings/new">New listing</Link>
        </Button>
      </div>

      {listings.length === 0 ? (
        <Card variant="gold">
          <CardHeader>
            <CardTitle className="text-gold">No listings yet</CardTitle>
            <CardDescription>
              Your first listing needs admin approval. Once approved, you can add availability slots
              and buyers can book you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              asChild
              className="bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow"
            >
              <Link href="/seller/listings/new">Create your first listing</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {listings.map((listing) => {
            const cover = listing.photos[0]?.url ?? null;
            return (
              <Card key={listing.id} variant="glow" className="overflow-hidden">
                <div className="aspect-[16/9] w-full overflow-hidden border-b border-border/70 bg-elevated">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover}
                      alt={listing.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      No photo
                    </div>
                  )}
                </div>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{listing.title}</CardTitle>
                    <Badge variant={listing.status === "approved" && !listing.is_active ? "secondary" : STATUS_VARIANTS[listing.status]} className="capitalize">
                      {listing.status === "approved" && !listing.is_active ? "Paused" : STATUS_LABELS[listing.status]}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {listing.description ?? ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-gold">
                        {listing.price_tokens.toLocaleString()}
                      </span>{" "}
                      tokens
                    </span>
                    <span>{listing.duration_minutes} min</span>
                    {listing.category ? <span>{listing.category.name}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/seller/listings/${listing.id}/edit`}>Edit</Link>
                    </Button>
                    {listing.status === "draft" || listing.status === "rejected" ? (
                      <SubmitListingButton
                        listingId={listing.id}
                        photoCount={listing.photos.length}
                      />
                    ) : null}
                    {listing.status === "approved" ? <ListingVisibilityButton listingId={listing.id} active={listing.is_active} /> : null}
                    <ArchiveListingButton listingId={listing.id} />
                  </div>
                </CardContent>
                {listing.status === "rejected" && listing.review_note ? (
                  <div className="border-t border-border/70 px-4 py-3 text-xs">
                    <span className="font-medium text-destructive">Last review:</span>{" "}
                    <span className="text-foreground">{listing.review_note}</span>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
