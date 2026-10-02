"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  EditIcon,
  Loader2Icon,
  ShieldOffIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  approveListingAction,
  rejectListingAction,
  editListingAction,
  adminUnpublishListingAction,
} from "@/app/admin/listings/actions";

export type AdminListingPhoto = {
  id: string;
  path: string;
  url: string | null;
  sort_order: number;
};

export type AdminListing = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_active: boolean;
  duration_minutes: number;
  price_tokens: number;
  category_id: string | null;
  category: { id: string; name: string; slug: string; sort_order: number; icon: string | null } | null;
  submitted_for_review_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  unpublished_reason: string | null;
  seller_display_name: string;
  seller_slug: string;
  photos: AdminListingPhoto[];
};

function categoryName(listing: AdminListing): string | null {
  return listing.category?.name ?? null;
}

export type CategoryChoice = {
  id: string;
  name: string;
};

type Props = {
  pending: AdminListing[];
  approved: AdminListing[];
  categories: CategoryChoice[];
};

export function AdminListingsManager({
  pending,
  approved,
  categories,
}: Props) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header>
          <h2 className="font-heading text-xl text-gold">Pending review</h2>
          <p className="text-sm text-muted-foreground">
            Approve, reject, or edit. Every action writes to the audit log with a before/after diff.
          </p>
        </header>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No listings awaiting review.
          </p>
        ) : (
          <div className="grid gap-4">
            {pending.map((listing) => (
              <PendingListingCard
                key={listing.id}
                listing={listing}
                categories={categories}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <header>
          <h2 className="font-heading text-xl text-gold">Approved listings</h2>
          <p className="text-sm text-muted-foreground">
            Listings that currently have approved status. Unpublish one to stop new bookings.
          </p>
        </header>
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved listings yet.</p>
        ) : (
          <div className="grid gap-4">
            {approved.map((listing) => (
              <ApprovedListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PendingListingCard({
  listing,
  categories,
}: {
  listing: AdminListing;
  categories: CategoryChoice[];
}) {
  return (
    <Card variant="glow">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{listing.title}</CardTitle>
            <CardDescription>
              By <span className="font-medium text-foreground">{listing.seller_display_name}</span>
              {listing.submitted_for_review_at ? (
                <>
                  {" · submitted "}
                  <LocalDateTime value={listing.submitted_for_review_at} />
                </>
              ) : null}
            </CardDescription>
          </div>
          <Badge variant="default">Pending review</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Duration" value={`${listing.duration_minutes} min`} />
          <Stat
            label="Price"
            value={`${listing.price_tokens.toLocaleString()} tokens`}
          />
          <Stat
            label="Category"
            value={categoryName(listing) ?? "—"}
          />
          <Stat label="Photos" value={String(listing.photos.length)} />
        </div>
        {listing.description ? (
          <p className="text-sm whitespace-pre-wrap text-foreground/90">
            {listing.description}
          </p>
        ) : null}
        {listing.photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {listing.photos.map((photo) => (
              <div
                key={photo.id}
                className="aspect-square overflow-hidden rounded-lg border border-gold/20"
              >
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    ?
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No photos uploaded.</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <ApproveButton listingId={listing.id} />
          <RejectButton listingId={listing.id} />
          <EditButton
            listingId={listing.id}
            listing={listing}
            categories={categories}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovedListingCard({ listing }: { listing: AdminListing }) {
  return (
    <Card data-testid={`admin-listing-${listing.id}`}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{listing.title}</CardTitle>
            <CardDescription>
              By {listing.seller_display_name}
              {listing.reviewed_at ? (
                <>
                  {" · approved "}
                  <LocalDateTime value={listing.reviewed_at} />
                </>
              ) : null}
            </CardDescription>
          </div>
          <Badge variant={listing.is_active ? "success" : "secondary"}>{listing.is_active ? "Approved" : "Paused"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Duration" value={`${listing.duration_minutes} min`} />
          <Stat
            label="Price"
            value={`${listing.price_tokens.toLocaleString()} tokens`}
          />
          <Stat label="Category" value={categoryName(listing) ?? "—"} />
          <Stat label="Photos" value={String(listing.photos.length)} />
        </div>
        {listing.unpublished_reason ? (
          <Alert variant="destructive">
            <AlertTitle>Previously unpublished</AlertTitle>
            <AlertDescription>{listing.unpublished_reason}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <UnpublishButton listingId={listing.id} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ApproveButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      className="bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await approveListingAction(listingId, null);
          if (!result.ok) throw new Error(result.error);
          toast.success("Approved.");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2Icon className="size-3 animate-spin" /> : <CheckCircle2Icon className="size-3" />}
      Approve
    </Button>
  );
}

function RejectButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <XCircleIcon className="size-3" />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject listing</DialogTitle>
          <DialogDescription>
            Tell the seller why (min 10 characters). They&apos;ll see this in their dashboard.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`reason-${listingId}`}>Reason</Label>
          <Textarea
            id={`reason-${listingId}`}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Photos need to be neutral and on-brand. Please re-shoot and resubmit."
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t reject</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              setReason("");
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-burgundy text-foreground hover:bg-burgundy/90"
            disabled={busy || reason.trim().length < 10}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await rejectListingAction(listingId, reason.trim());
                if (!result.ok) throw new Error(result.error);
                toast.success("Rejected.");
                setOpen(false);
                setReason("");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditButton({
  listingId,
  listing,
  categories,
}: {
  listingId: string;
  listing: AdminListing;
  categories: CategoryChoice[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description ?? "");
  const [duration, setDuration] = useState(String(listing.duration_minutes));
  const [price, setPrice] = useState(String(listing.price_tokens));
  const [categoryId, setCategoryId] = useState(listing.category_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setTitle(listing.title);
          setDescription(listing.description ?? "");
          setDuration(String(listing.duration_minutes));
          setPrice(String(listing.price_tokens));
          setCategoryId(listing.category_id ?? "");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <EditIcon className="size-3" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit listing</DialogTitle>
          <DialogDescription>
            Changes are saved with a before/after diff in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`title-${listingId}`}>Title</Label>
            <Input
              id={`title-${listingId}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`desc-${listingId}`}>Description</Label>
            <Textarea
              id={`desc-${listingId}`}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`duration-${listingId}`}>Duration</Label>
            <Input
              id={`duration-${listingId}`}
              type="number"
              min={5}
              max={240}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`price-${listingId}`}>Price (tokens)</Label>
            <Input
              id={`price-${listingId}`}
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`cat-${listingId}`}>Category</Label>
            <select
              id={`cat-${listingId}`}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Select a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-burgundy text-foreground hover:bg-burgundy/90"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await editListingAction(listingId, {
                  title,
                  description,
                  duration_minutes: Number(duration),
                  price_tokens: Number(price),
                  category_id: categoryId || null,
                });
                if (!result.ok) throw new Error(result.error);
                toast.success("Saved.");
                setOpen(false);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnpublishButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ShieldOffIcon className="size-3" />
          Unpublish
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unpublish listing</DialogTitle>
          <DialogDescription>
            Add a reason for the seller. One character is enough.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`reason-${listingId}`}>Reason</Label>
          <Textarea
            id={`reason-${listingId}`}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t unpublish</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              setReason("");
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-burgundy text-foreground hover:bg-burgundy/90"
            disabled={busy || reason.trim().length === 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await adminUnpublishListingAction(
                  listingId,
                  reason.trim()
                );
                if (!result.ok) throw new Error(result.error);
                toast.success("Unpublished.");
                setOpen(false);
                setReason("");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
            Unpublish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
