"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { setOwnListingActiveAction } from "@/app/seller/listings/actions";
import { Button } from "@/components/ui/button";

export function ListingVisibilityButton({ listingId, active }: { listingId: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = active ? "Pause listing" : "Activate listing";

  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {
      startTransition(async () => {
        const result = await setOwnListingActiveAction(listingId, !active);
        if (result.ok) {
          toast.success(active ? "Listing paused. Existing orders remain available." : "Listing is live and bookable.");
          router.refresh();
        } else {
          toast.error(result.error);
        }
      });
    }}>
      {pending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}
