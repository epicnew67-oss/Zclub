"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { archiveOwnListingAction } from "@/app/seller/listings/actions";
import { Button } from "@/components/ui/button";

export function ArchiveListingButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-xs">
        <span>Delete this listing? Existing orders stay available.</span>
        <Button size="xs" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>Keep</Button>
        <Button size="xs" variant="destructive" disabled={pending} onClick={() => {
          startTransition(async () => {
            const result = await archiveOwnListingAction(listingId);
            if (result.ok) {
              toast.success("Listing removed. Existing orders are still available.");
              router.refresh();
            } else {
              toast.error(result.error);
            }
            setConfirming(false);
          });
        }}>
          {pending ? <Loader2Icon className="size-3 animate-spin" /> : "Yes, delete"}
        </Button>
      </div>
    );
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
      <Trash2Icon className="size-3.5" /> Delete listing
    </Button>
  );
}
