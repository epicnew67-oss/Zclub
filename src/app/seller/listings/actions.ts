"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { alertListingSubmitted } from "@/lib/admin-alerts";

export type CreateListingInput = {
  title: string;
  description: string;
  categoryId: string;
  durationMinutes: number;
  priceTokens: number;
  photoPaths: string[];
};

export type UpdateListingInput = Omit<CreateListingInput, "photoPaths">;

export type ListingActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function validateBasics(input: {
  title: string;
  description: string;
  categoryId: string;
  durationMinutes: number;
  priceTokens: number;
}): string | null {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 120) {
    return "Title must be 3–120 characters.";
  }
  const description = input.description.trim();
  if (description.length < 10) {
    return "Description must be at least 10 characters.";
  }
  if (!input.categoryId) return "Category is required.";
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 240) {
    return "Duration must be 5–240 minutes.";
  }
  if (!Number.isFinite(input.priceTokens) || input.priceTokens <= 0) {
    return "Price must be greater than zero.";
  }
  return null;
}

function sanitizePhotos(userId: string, paths: string[]): string[] | string {
  const cleaned: string[] = [];
  for (const p of paths) {
    if (!p || typeof p !== "string") continue;
    const trimmed = p.trim();
    if (!trimmed.startsWith(`${userId}/`)) {
      return "Photo path is outside your folder.";
    }
    cleaned.push(trimmed);
  }
  if (cleaned.length > 6) return "Up to 6 photos per listing.";
  return cleaned;
}

export async function createListingDraftAction(
  input: CreateListingInput
): Promise<ListingActionResult<{ id: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const validation = validateBasics(input);
  if (validation) return { ok: false, error: validation };

  const cleaned = sanitizePhotos(user.id, input.photoPaths);
  if (typeof cleaned === "string") return { ok: false, error: cleaned };

  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!seller) {
    return { ok: false, error: "Only approved sellers can create listings." };
  }

  const { data: listing, error } = await supabase
    .from("listings")
    .insert({
      seller_id: seller.id,
      title: input.title.trim(),
      description: input.description.trim(),
      category_id: input.categoryId,
      duration_minutes: input.durationMinutes,
      price_tokens: input.priceTokens,
      status: "draft",
      is_active: false,
    })
    .select("id")
    .single();
  if (error || !listing) {
    return { ok: false, error: error?.message ?? "Could not create the draft." };
  }

  if (cleaned.length > 0) {
    const photoRows = cleaned.map((path, idx) => ({
      listing_id: listing.id,
      path,
      sort_order: idx,
    }));
    const { error: photoError } = await supabase
      .from("listing_photos")
      .insert(photoRows);
    if (photoError) {
      return {
        ok: false,
        error: `Listing saved but photos failed: ${photoError.message}`,
      };
    }
  }

  revalidatePath("/seller/listings");
  return { ok: true, data: { id: listing.id } };
}

export async function updateListingDraftAction(
  listingId: string,
  input: UpdateListingInput
): Promise<ListingActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const validation = validateBasics(input);
  if (validation) return { ok: false, error: validation };

  // Defence in depth: scope the update to listings owned by the
  // current seller. RLS already enforces this, but pinning the
  // seller_id filter at the action layer prevents a misconfigured
  // policy from silently broadening the write surface.
  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!seller) {
    return { ok: false, error: "Only approved sellers can edit listings." };
  }

  const { error } = await supabase
    .from("listings")
    .update({
      title: input.title.trim(),
      description: input.description.trim(),
      category_id: input.categoryId,
      duration_minutes: input.durationMinutes,
      price_tokens: input.priceTokens,
    })
    .eq("id", listingId)
    .eq("seller_id", seller.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/seller/listings/${listingId}/edit`);
  revalidatePath("/seller/listings");
  return { ok: true, data: undefined };
}

export async function submitListingForReviewAction(
  listingId: string
): Promise<ListingActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_listing_for_review", {
    _listing_id: listingId,
  } as never);
  if (error) return { ok: false, error: error.message };

  // Ping the admin queue so submissions don't sit unseen — the listing
  // stays invisible to customers until an admin approves it.
  try {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("listings")
      .select("title, seller:seller_profiles(display_name)")
      .eq("id", listingId)
      .maybeSingle();
    await alertListingSubmitted({
      listingId,
      title: (row?.title as string) ?? "Listing",
      sellerName:
        ((row?.seller as { display_name?: string } | null)?.display_name) ??
        "A seller",
    });
  } catch {
    // best effort — the listing is already submitted
  }

  revalidatePath("/seller/listings");
  revalidatePath("/admin/listings");
  return { ok: true, data: undefined };
}

export async function unpublishOwnListingAction(
  listingId: string,
  reason: string | null
): Promise<ListingActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpublish_listing", {
    _listing_id: listingId,
    _reason: reason && reason.trim() ? reason.trim() : null,
  } as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/seller/listings");
  revalidatePath("/admin/listings");
  return { ok: true, data: undefined };
}

export async function archiveOwnListingAction(
  listingId: string
): Promise<ListingActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_own_listing", {
    _listing_id: listingId,
  } as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/seller/listings");
  revalidatePath("/seller/availability");
  revalidatePath("/seller");
  revalidatePath("/browse");
  revalidatePath("/");
  return { ok: true, data: undefined };
}

export async function setOwnListingActiveAction(
  listingId: string,
  active: boolean
): Promise<ListingActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_own_listing_active", {
    _listing_id: listingId,
    _active: active,
  } as never);
  if (error) return { ok: false, error: error.message };

  for (const path of ["/seller/listings", "/seller/availability", "/seller", "/browse", "/"]) {
    revalidatePath(path);
  }
  return { ok: true, data: undefined };
}
