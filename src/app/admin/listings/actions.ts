"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AdminListingActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function approveListingAction(
  listingId: string,
  note: string | null
): Promise<AdminListingActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const { error } = await supabase.rpc("approve_listing", {
    _listing_id: listingId,
    _note: note && note.trim() ? note.trim() : null,
  } as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/listings");
  revalidatePath("/seller/listings");
  return { ok: true, data: undefined };
}

export async function rejectListingAction(
  listingId: string,
  reason: string
): Promise<AdminListingActionResult> {
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    return { ok: false, error: "Rejection reason must be at least 10 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const { error } = await supabase.rpc("reject_listing", {
    _listing_id: listingId,
    _reason: trimmed,
  } as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/listings");
  revalidatePath("/seller/listings");
  return { ok: true, data: undefined };
}

export type EditListingPatch = {
  title?: string;
  description?: string;
  category_id?: string | null;
  duration_minutes?: number;
  price_tokens?: number;
};

export async function editListingAction(
  listingId: string,
  patch: EditListingPatch
): Promise<AdminListingActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  // The RPC validates field shapes server-side; we still guard empty
  // patches client-side to avoid no-op calls.
  const hasAny =
    patch.title !== undefined ||
    patch.description !== undefined ||
    patch.category_id !== undefined ||
    patch.duration_minutes !== undefined ||
    patch.price_tokens !== undefined;
  if (!hasAny) {
    return { ok: false, error: "No changes to apply." };
  }

  const { error } = await supabase.rpc("edit_listing", {
    _listing_id: listingId,
    _patch: patch as never,
  } as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/listings");
  revalidatePath("/seller/listings");
  return { ok: true, data: undefined };
}

export async function adminUnpublishListingAction(
  listingId: string,
  reason: string
): Promise<AdminListingActionResult> {
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    return { ok: false, error: "Admin unpublish requires a reason (≥10 characters)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const { error } = await supabase.rpc("unpublish_listing", {
    _listing_id: listingId,
    _reason: trimmed,
  } as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/listings");
  revalidatePath("/seller/listings");
  return { ok: true, data: undefined };
}