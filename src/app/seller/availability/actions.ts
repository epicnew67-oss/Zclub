"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AvailabilityActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Add a slot. `startsAtLocal` is the value from
 * `<input type="datetime-local">` (no timezone) — interpreted as the
 * user's local time, then stored as UTC.
 */
export async function addSlotAction(input: {
  listingId: string;
  startsAtLocal: string; // "YYYY-MM-DDTHH:mm"
  durationMinutes: number;
  priceTokens: number;
}): Promise<AvailabilityActionResult<{ slotId: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  if (!input.listingId) return { ok: false, error: "Pick a listing first." };
  if (!input.startsAtLocal) {
    return { ok: false, error: "Pick a start date and time." };
  }
  if (
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes < 5 ||
    input.durationMinutes > 240
  ) {
    return { ok: false, error: "Duration must be 5–240 minutes." };
  }
  if (!Number.isFinite(input.priceTokens) || input.priceTokens <= 0) {
    return { ok: false, error: "Price must be greater than zero." };
  }

  // Treat the local datetime as the browser's local timezone by
  // constructing a Date and serializing to UTC ISO. The Date
  // constructor with a "YYYY-MM-DDTHH:mm" string interprets it as
  // local time, which matches what the input shows.
  const startsAtDate = new Date(input.startsAtLocal);
  if (Number.isNaN(startsAtDate.getTime())) {
    return { ok: false, error: "Invalid date." };
  }
  const startsAtIso = startsAtDate.toISOString();
  const endsAtIso = new Date(
    startsAtDate.getTime() + input.durationMinutes * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase.rpc("add_listing_slot", {
    _listing_id: input.listingId,
    _starts_at: startsAtIso,
    _ends_at: endsAtIso,
    _price_tokens: input.priceTokens,
  } as never);
  if (error) return { ok: false, error: error.message };

  const slotId =
    data && typeof data === "object" && "slot_id" in data
      ? String((data as { slot_id: string }).slot_id)
      : "";

  revalidatePath("/seller/availability");
  revalidatePath("/seller/listings");
  return { ok: true, data: { slotId } };
}

export async function removeSlotAction(
  slotId: string
): Promise<AvailabilityActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_listing_slot", {
    _slot_id: slotId,
  } as never);
  if (error) {
    // Already gone (double-click, stale tab, already booked/removed
    // elsewhere)? The desired end state is achieved — treat as success
    // instead of surfacing a scary "not found" error.
    if (error.message.toLowerCase().includes("not found")) {
      revalidatePath("/seller/availability");
      revalidatePath("/seller/listings");
      return { ok: true, data: undefined };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/seller/availability");
  revalidatePath("/seller/listings");
  return { ok: true, data: undefined };
}