"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, SendIcon } from "lucide-react";
import { submitListingForReviewAction } from "@/app/seller/listings/actions";
import { Button } from "@/components/ui/button";

/**
 * One-click "Submit for review" on the seller listings page. Disabled with
 * a clear hint until the listing has at least one photo (the DB refuses
 * photo-less submissions) — then the admin queue gets pinged.
 */
export function SubmitListingButton({
  listingId,
  photoCount,
}: {
  listingId: string;
  photoCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const missingPhoto = photoCount < 1;

  async function submit() {
    setBusy(true);
    try {
      const result = await submitListingForReviewAction(listingId);
      if (!result.ok) throw new Error(result.error);
      toast.success("Submitted for review — an admin will approve it shortly.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not submit for review."
      );
    } finally {
      setBusy(false);
    }
  }

  if (missingPhoto) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled
          title="Add at least one photo before submitting"
        >
          Submit for review
        </Button>
        <Link
          href={`/seller/listings/${listingId}/edit`}
          className="text-xs text-gold hover:underline"
        >
          Add at least one photo first →
        </Link>
      </span>
    );
  }

  return (
    <Button size="sm" className="shadow-gold" disabled={busy} onClick={submit}>
      {busy ? (
        <Loader2Icon data-icon="inline-start" className="animate-spin" />
      ) : (
        <SendIcon data-icon="inline-start" />
      )}
      Submit for review
    </Button>
  );
}
