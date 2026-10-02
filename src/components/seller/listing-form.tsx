"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { InfoIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";
import { LISTING_PHOTOS_BUCKET } from "@/lib/listings/photos-bucket";
import {
  createListingDraftAction,
  updateListingDraftAction,
  submitListingForReviewAction,
} from "@/app/seller/listings/actions";

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
};

export type ExistingPhoto = {
  id: string;
  path: string;
  url: string | null;
};

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      listingId: string;
      initial: {
        title: string;
        description: string;
        categoryId: string | null;
        durationMinutes: number;
        priceTokens: number;
        status: string;
      };
      existingPhotos: ExistingPhoto[];
    };

type Props = {
  categories: CategoryOption[];
  mode: Mode;
};

const MAX_PHOTOS = 6;

export function ListingForm({ categories, mode }: Props) {
  const router = useRouter();

  const initial = mode.kind === "edit" ? mode.initial : null;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  // Retain the legacy schema value when editing; on-demand calls have no advertised duration.
  const durationMinutes = initial?.durationMinutes ?? 30;
  const [priceTokens, setPriceTokens] = useState(
    String(initial?.priceTokens ?? "200")
  );

  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[]>(
    mode.kind === "edit" ? mode.existingPhotos : []
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviewUrls, setNewPreviewUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPickFiles(fileList: FileList | null) {
    if (!fileList) return;
    const remaining = MAX_PHOTOS - existingPhotos.length - newFiles.length;
    const accepted = Array.from(fileList).slice(0, Math.max(0, remaining));
    if (accepted.length === 0) {
      toast.error(`Up to ${MAX_PHOTOS} photos per listing.`);
      return;
    }
    setNewFiles((prev) => [...prev, ...accepted]);
    setNewPreviewUrls((prev) => [
      ...prev,
      ...accepted.map((f) => URL.createObjectURL(f)),
    ]);
  }

  function removeNewAt(idx: number) {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
    setNewPreviewUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function removeExisting(photo: ExistingPhoto) {
    const supabase = createClient();
    const { error } = await supabase
      .from("listing_photos")
      .delete()
      .eq("id", photo.id);
    if (error) {
      toast.error(`Could not remove photo: ${error.message}`);
      return;
    }
    setExistingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    // Best-effort: remove from storage too. Failures don't block.
    supabase.storage
      .from(LISTING_PHOTOS_BUCKET)
      .remove([photo.path])
      .catch(() => {});
  }

  /**
   * Persist the form: uploads new photos, then creates/saves the draft.
   * Shared by "Save" and "Submit for review" so submitting never sends
   * stale data.
   */
  async function persistEdits(): Promise<{ createdId: string | null }> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in required.");

    // Upload new files into the owner folder.
    const newPaths: string[] = [];
    for (const file of newFiles) {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/listing-${mode.kind === "edit" ? mode.listingId : "draft"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(LISTING_PHOTOS_BUCKET)
        .upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: true,
        });
      if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
      newPaths.push(path);
    }

    if (mode.kind === "create") {
      const result = await createListingDraftAction({
        title,
        description,
        categoryId,
        durationMinutes,
        priceTokens: Number(priceTokens),
        photoPaths: newPaths,
      });
      if (!result.ok) throw new Error(result.error);
      return { createdId: result.data.id };
    }

    if (newPaths.length > 0) {
      const photoRows = newPaths.map((path, idx) => ({
        listing_id: mode.listingId,
        path,
        sort_order: existingPhotos.length + idx,
      }));
      const { error: photoErr } = await supabase
        .from("listing_photos")
        .insert(photoRows);
      if (photoErr) throw new Error(photoErr.message);
    }
    const result = await updateListingDraftAction(mode.listingId, {
      title,
      description,
      categoryId,
      durationMinutes,
      priceTokens: Number(priceTokens),
    });
    if (!result.ok) throw new Error(result.error);
    return { createdId: null };
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { createdId } = await persistEdits();
      if (createdId) {
        toast.success("Draft saved — add a photo, then Submit for review.");
        router.push(`/seller/listings/${createdId}/edit`);
      } else {
        toast.success("Saved.");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitForReview() {
    if (mode.kind !== "edit") return;
    if (existingPhotos.length + newFiles.length === 0) {
      setError(
        "Add at least one photo in the Photos section below, then submit for review."
      );
      toast.error("A photo is required before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Save any unsaved edits + photos first, then submit.
      await persistEdits();
      const result = await submitListingForReviewAction(mode.listingId);
      if (!result.ok) throw new Error(result.error);
      toast.success("Submitted for review — an admin will approve it shortly.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }

  const totalPhotos = existingPhotos.length + newFiles.length;
  const status = mode.kind === "edit" ? mode.initial.status : "draft";
  const canSubmit = mode.kind === "edit" && (status === "draft" || status === "rejected");
  const reviewNote = mode.kind === "edit" ? null : null;

  return (
    <form onSubmit={handleSave} className="space-y-4" noValidate>
      <Card variant="gold">
        <CardHeader>
          <CardTitle className="text-gold">
            {mode.kind === "create" ? "New listing" : "Edit listing"}
          </CardTitle>
          <CardDescription>
            Title, description, category, and price. Up to {MAX_PHOTOS} photos.
            Status: <span className="font-medium text-foreground">{status}</span>.
            {mode.kind === "edit" && status === "rejected" && reviewNote
              ? null
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Friendly one-on-one chats"
                maxLength={120}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What buyers can expect — topics, style, boundaries."
                rows={5}
              />
              <p className="text-xs text-muted-foreground">{description.length} chars</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
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
            <div className="space-y-2">
              <Label htmlFor="price">Price (tokens)</Label>
              <Input
                id="price"
                type="number"
                min={1}
                value={priceTokens}
                onChange={(e) => setPriceTokens(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
          <CardDescription>
            Up to {MAX_PHOTOS} photos. JPG / PNG, neutral imagery only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {existingPhotos.map((p) => (
              <div
                key={p.id}
                className="relative aspect-square overflow-hidden rounded-lg border border-gold/20"
              >
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    ?
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removeExisting(p)}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Trash2Icon className="size-3" />
                </button>
              </div>
            ))}
            {newPreviewUrls.map((url, idx) => (
              <div
                key={`new-${idx}`}
                className="relative aspect-square overflow-hidden rounded-lg border border-gold/30"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removeNewAt(idx)}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Trash2Icon className="size-3" />
                </button>
              </div>
            ))}
          </div>
          {totalPhotos < MAX_PHOTOS ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gold/30 px-3 py-2 text-sm text-muted-foreground hover:bg-gold/5">
              <UploadIcon className="size-4 text-gold" />
              <span>Add photos</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">
              You&apos;ve reached the {MAX_PHOTOS}-photo limit. Remove one to add another.
            </p>
          )}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canSubmit ? (
        <Alert className="border-gold/30 bg-gold/5">
          <InfoIcon className="text-gold" />
          <AlertTitle>How to post this listing</AlertTitle>
          <AlertDescription>
            {totalPhotos === 0
              ? "Add at least one photo in the Photos section above, then click Submit for review. An admin approves it and it goes live in Browse."
              : "Click Submit for review — your changes are saved first. An admin approves it and it goes live in Browse."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={submitting}
          className="bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow"
        >
          {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {mode.kind === "create" ? "Save draft" : "Save changes"}
        </Button>
        {canSubmit ? (
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={handleSubmitForReview}
          >
            Submit for review
          </Button>
        ) : null}
      </div>
    </form>
  );
}
