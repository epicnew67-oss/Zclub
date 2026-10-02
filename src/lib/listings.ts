/**
 * Listings server helpers — server-only wrappers around the listings
 * workflow (submit-for-review, approve, reject, edit, unpublish) and
 * the read paths used by the seller dashboard and admin moderation
 * queue. Photo paths stored in `listing_photos.path` are signed here
 * before being returned (the `listing-photos` bucket is private).
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { LISTING_PHOTOS_BUCKET as BUCKET_NAME } from "@/lib/listings/photos-bucket";
import { isSafeImagePath } from "@/lib/safe-image-path";

export { LISTING_PHOTOS_BUCKET } from "@/lib/listings/photos-bucket";

export const LISTING_PHOTOS_BUCKET_INTERNAL = BUCKET_NAME;
const SIGNED_URL_TTL_SECONDS = 600;

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "unpublished";

export type ListingPhoto = {
  id: string;
  path: string;
  sort_order: number;
  url: string | null;
};

export type ListingRow = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  price_tokens: number;
  duration_minutes: number;
  status: ListingStatus;
  is_active: boolean;
  submitted_for_review_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  unpublished_reason: string | null;
  soft_deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  icon: string | null;
};

export type ListingDetail = ListingRow & {
  category: Category | null;
  photos: ListingPhoto[];
};

export type AdminQueueRow = ListingDetail & {
  seller_display_name: string;
  seller_slug: string;
  seller_user_id: string;
};

// ---------------------------------------------------------------- internal

async function signPhotoPathsInternal(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const signed = await Promise.all(
    paths.filter(isSafeImagePath).map(async (p) => {
      const { data, error } = await admin.storage
        .from(BUCKET_NAME)
        .createSignedUrl(p, SIGNED_URL_TTL_SECONDS);
      return { path: p, url: error || !data?.signedUrl ? null : data.signedUrl };
    })
  );
  for (const { path, url } of signed) {
    if (url) map.set(path, url);
  }
  return map;
}

export async function signPhotoPaths(
  paths: string[]
): Promise<Map<string, string>> {
  return signPhotoPathsInternal(createAdminClient(), paths);
}

async function decorateWithPhotosAndCategory(
  admin: ReturnType<typeof createAdminClient>,
  listing: ListingRow,
  categoryMap: Map<string, Category>
): Promise<ListingDetail> {
  const { data: photoRows } = await admin
    .from("listing_photos")
    .select("id, path, sort_order")
    .eq("listing_id", listing.id)
    .order("sort_order");

  const pathList = (photoRows ?? []).map((p) => p.path);
  const signed = await signPhotoPathsInternal(admin, pathList);

  return {
    ...listing,
    category: listing.category_id ? categoryMap.get(listing.category_id) ?? null : null,
    photos: (photoRows ?? []).map((p) => ({
      id: p.id,
      path: p.path,
      sort_order: p.sort_order,
      url: signed.get(p.path) ?? null,
    })),
  };
}

async function loadCategories(
  admin: ReturnType<typeof createAdminClient>
): Promise<Map<string, Category>> {
  const { data } = await admin
    .from("categories")
    .select("id, name, slug, sort_order, icon")
    .eq("is_active", true)
    .order("sort_order");
  const map = new Map<string, Category>();
  for (const c of (data ?? []) as Category[]) map.set(c.id, c);
  return map;
}

// ---------------------------------------------------------------- reads

export async function getCategories(): Promise<Category[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("categories")
    .select("id, name, slug, sort_order, icon")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as Category[];
}

export async function listSellerListings(
  sellerProfileId: string
): Promise<ListingDetail[]> {
  const admin = createAdminClient();
  const [{ data: rows }, categoryMap] = await Promise.all([
    admin
      .from("listings")
      .select(
        "id, seller_id, title, description, category_id, price_tokens, duration_minutes, status, is_active, submitted_for_review_at, reviewed_at, reviewed_by, review_note, unpublished_reason, soft_deleted_at, created_at, updated_at"
      )
      .eq("seller_id", sellerProfileId)
      .is("soft_deleted_at", null)
      .order("updated_at", { ascending: false }),
    loadCategories(admin),
  ]);
  const listings = (rows ?? []) as ListingRow[];
  return Promise.all(
    listings.map((l) => decorateWithPhotosAndCategory(admin, l, categoryMap))
  );
}

export async function getListingForSeller(
  sellerProfileId: string,
  listingId: string
): Promise<ListingDetail | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("listings")
    .select(
      "id, seller_id, title, description, category_id, price_tokens, duration_minutes, status, is_active, submitted_for_review_at, reviewed_at, reviewed_by, review_note, unpublished_reason, soft_deleted_at, created_at, updated_at"
    )
    .eq("id", listingId)
    .eq("seller_id", sellerProfileId)
    .is("soft_deleted_at", null)
    .maybeSingle();
  if (!row) return null;
  const categoryMap = await loadCategories(admin);
  return decorateWithPhotosAndCategory(admin, row as ListingRow, categoryMap);
}

export async function listPendingReviewListings(): Promise<AdminQueueRow[]> {
  const admin = createAdminClient();
  const [{ data: rows }, categoryMap] = await Promise.all([
    admin
      .from("listings")
      .select(
        "id, seller_id, title, description, category_id, price_tokens, duration_minutes, status, is_active, submitted_for_review_at, reviewed_at, reviewed_by, review_note, unpublished_reason, soft_deleted_at, created_at, updated_at"
      )
      .eq("status", "pending_review")
      .is("soft_deleted_at", null)
      .order("submitted_for_review_at", { ascending: true }),
    loadCategories(admin),
  ]);
  const listings = (rows ?? []) as ListingRow[];
  if (listings.length === 0) return [];

  const sellerIds = [...new Set(listings.map((l) => l.seller_id))];
  const { data: sellerRows } = await admin
    .from("seller_profiles")
    .select("id, display_name, slug, user_id")
    .in("id", sellerIds);
  const sellerMap = new Map<string, { display_name: string; slug: string; user_id: string }>();
  for (const s of sellerRows ?? []) {
    sellerMap.set(s.id as string, {
      display_name: (s.display_name as string) ?? "",
      slug: (s.slug as string) ?? "",
      user_id: (s.user_id as string) ?? "",
    });
  }

  return Promise.all(
    listings.map(async (l) => {
      const detail = await decorateWithPhotosAndCategory(admin, l, categoryMap);
      const seller = sellerMap.get(l.seller_id);
      return {
        ...detail,
        seller_display_name: seller?.display_name ?? "—",
        seller_slug: seller?.slug ?? "",
        seller_user_id: seller?.user_id ?? "",
      };
    })
  );
}

export async function listAdminListingsHistory(): Promise<AdminQueueRow[]> {
  const admin = createAdminClient();
  const [{ data: rows }, categoryMap] = await Promise.all([
    admin
      .from("listings")
      .select(
        "id, seller_id, title, description, category_id, price_tokens, duration_minutes, status, is_active, submitted_for_review_at, reviewed_at, reviewed_by, review_note, unpublished_reason, soft_deleted_at, created_at, updated_at"
      )
      .eq("status", "approved")
      .is("soft_deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(50),
    loadCategories(admin),
  ]);
  const listings = (rows ?? []) as ListingRow[];
  if (listings.length === 0) return [];

  const sellerIds = [...new Set(listings.map((l) => l.seller_id))];
  const { data: sellerRows } = await admin
    .from("seller_profiles")
    .select("id, display_name, slug, user_id")
    .in("id", sellerIds);
  const sellerMap = new Map<string, { display_name: string; slug: string; user_id: string }>();
  for (const s of sellerRows ?? []) {
    sellerMap.set(s.id as string, {
      display_name: (s.display_name as string) ?? "",
      slug: (s.slug as string) ?? "",
      user_id: (s.user_id as string) ?? "",
    });
  }

  return Promise.all(
    listings.map(async (l) => {
      const detail = await decorateWithPhotosAndCategory(admin, l, categoryMap);
      const seller = sellerMap.get(l.seller_id);
      return {
        ...detail,
        seller_display_name: seller?.display_name ?? "—",
        seller_slug: seller?.slug ?? "",
        seller_user_id: seller?.user_id ?? "",
      };
    })
  );
}

// ---------------------------------------------------------------- slots

export type Slot = {
  id: string;
  listing_id: string;
  starts_at: string;
  ends_at: string;
  price_tokens: number;
  status: "open" | "booked" | "blocked";
  bookingId?: string | null;
  bookingStatus?: string | null;
};

export async function listSlotsForListing(
  listingId: string
): Promise<Slot[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("availability_slots")
    .select("id, listing_id, starts_at, ends_at, price_tokens, status")
    .eq("listing_id", listingId)
    .order("starts_at", { ascending: true });
  return (data ?? []) as Slot[];
}

export async function listSlotsForSellerListings(
  sellerProfileId: string
): Promise<Slot[]> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("availability_slots")
    .select(
      "id, listing_id, starts_at, ends_at, price_tokens, status, listings!inner(seller_id)"
    )
    .eq("listings.seller_id", sellerProfileId)
    .order("starts_at", { ascending: true });
  type Joined = {
    id: string;
    listing_id: string;
    starts_at: string;
    ends_at: string;
    price_tokens: number;
    status: Slot["status"];
    listings: { seller_id: string }[];
  };
  const sellerSlots = ((rows ?? []) as unknown as Joined[]).map((r) => ({
    id: r.id,
    listing_id: r.listing_id,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    price_tokens: r.price_tokens,
    status: r.status,
  }));
  const bookedIds = sellerSlots.filter((slot) => slot.status === "booked").map((slot) => slot.id);
  if (bookedIds.length === 0) return sellerSlots;
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, slot_id, status")
    .in("slot_id", bookedIds)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  const bySlot = new Map<string, { id: string; status: string }>();
  for (const booking of bookings ?? []) {
    if (!bySlot.has(booking.slot_id)) bySlot.set(booking.slot_id, booking);
  }
  return sellerSlots.map((slot) => ({
    ...slot,
    bookingId: bySlot.get(slot.id)?.id ?? null,
    bookingStatus: bySlot.get(slot.id)?.status ?? null,
  }));
}

export type ApprovedListingForSlots = {
  id: string;
  title: string;
  duration_minutes: number;
  price_tokens: number;
};

export type AvailabilitySnapshot = {
  listings: ApprovedListingForSlots[];
  slots: Slot[];
};

export async function listApprovedListingsWithSlots(
  sellerProfileId: string
): Promise<AvailabilitySnapshot> {
  const admin = createAdminClient();
  const [listingRows, listSlots] = await Promise.all([
    admin
      .from("listings")
      .select("id, title, duration_minutes, price_tokens")
      .eq("seller_id", sellerProfileId)
      .eq("status", "approved")
      .is("soft_deleted_at", null)
      .order("updated_at", { ascending: false }),
    listSlotsForSellerListings(sellerProfileId),
  ]);
  return {
    listings: (listingRows.data ?? []) as ApprovedListingForSlots[],
    slots: listSlots,
  };
}
