/**
 * Public-facing read helpers for the buyer pages (Home, Browse, Listing
 * detail). Server-only — uses the admin client to bypass RLS so we can
 * sign photo paths in one query. RLS already allows public select on
 * `listings`, `seller_profiles`, `categories`, `availability_slots`,
 * so the auth-less server flow has the same blast radius as a
 * non-privileged anon key would have.
 */

import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LISTING_PHOTOS_BUCKET } from "@/lib/listings/photos-bucket";
import { isSafeImagePath } from "@/lib/safe-image-path";
import { signPhotoPaths as _signPhotoPaths } from "@/lib/listings";

const SIGNED_URL_TTL_SECONDS = 600;

// -------------------------------------------------------------- test markers
//
// Test scripts under `scripts/test-*.mjs` seed rows whose display_name
// or title follows one of these patterns. We never want those to leak
// into the public homepage, /browse, or featured lists, so we filter
// them at the SQL layer (network round-trip stays small) and again at
// the decorate step (safety net for legacy / hand-seeded data that
// didn't run through the shared scripts).
//
// When adding new test patterns, update this list — do not rely on
// "we'll just delete those rows" because the request was explicit:
// *do not* delete DB records, fix the public presentation layer.

const TEST_SELLER_DISPLAY_NAME_PATTERNS: string[] = [
  // scripts/test-*.mjs: every test fixtures a seller with
  // `${prefix}-display` (e.g. `ap-test-seller-display`,
  // `pcm-test-seller-display`, `booking-test-seller-display`).
  "%-test-seller-display",
  // scripts/test-sellers.mjs seeds a generic "Test Seller".
  "Test Seller",
  // scripts/test-wallet.mjs seeds "Wallet Test".
  "Wallet Test",
];

const TEST_LISTING_TITLE_PATTERNS: Array<{ op: "ilike" | "eq"; value: string }> = [
  // scripts/test-{bookings,livekit,admin-panel,post-call-money}.mjs
  // use `Test listing ${Date.now().toString(36)}` as their title.
  { op: "ilike", value: "Test listing%" },
  // scripts/test-listings.mjs seeds three fixtures with literal names.
  { op: "eq", value: "Book chats" },
  { op: "eq", value: "Movie chats" },
  { op: "eq", value: "Travel chats" },
  { op: "ilike", value: "Grace window check%" },
];

function isTestSellerDisplayName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lowered = name.toLowerCase();
  for (const pattern of TEST_SELLER_DISPLAY_NAME_PATTERNS) {
    if (pattern.includes("%")) {
      // SQL-style glob with % as wildcard; convert to a JS test.
      const regex = new RegExp(
        "^" +
          pattern
            .toLowerCase()
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/%/g, ".*") +
          "$",
      );
      if (regex.test(lowered)) return true;
    } else {
      if (lowered === pattern.toLowerCase()) return true;
    }
  }
  return false;
}

function isTestListingTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const lowered = title.toLowerCase();
  for (const pattern of TEST_LISTING_TITLE_PATTERNS) {
    if (pattern.op === "eq") {
      if (lowered === pattern.value.toLowerCase()) return true;
    } else {
      // ilike prefix match
      if (lowered.startsWith(pattern.value.slice(0, -1).toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

export type BrowseSeller = {
  user_id: string;
  slug: string;
  display_name: string;
  is_verified: boolean;
  tagline: string | null;
  bio: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  presence: "available" | "booked" | "in_call" | "offline";
};

export type BrowseCategory = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
};

export type BrowseListing = {
  id: string;
  /** Public slug: `<seller-slug>--<listing-title-slug>`. */
  slug: string;
  title: string;
  price_tokens: number;
  duration_minutes: number;
  cover: string | null;
  seller: BrowseSeller;
  category: BrowseCategory | null;
  created_at: string;
};

export type BrowseSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  price_tokens: number;
};

export type BrowseListingDetail = BrowseListing & {
  description: string | null;
  photos: { id: string; url: string | null; sort_order: number }[];
};

export type BrowseSort =
  | "newest"
  | "price_asc"
  | "price_desc"
  | "duration_asc"
  | "duration_desc";

export type BrowseFilters = {
  search?: string;
  categorySlug?: string;
  sort?: BrowseSort;
  limit?: number;
  offset?: number;
};

// ---------------------------------------------------------------- internal

function listingTitleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function makeListingSlug(sellerSlug: string, title: string): string {
  return `${sellerSlug}--${listingTitleSlug(title)}`;
}

export function splitListingSlug(slug: string): {
  sellerSlug: string;
  titleSlug: string;
} | null {
  const idx = slug.indexOf("--");
  if (idx <= 0 || idx >= slug.length - 2) return null;
  return { sellerSlug: slug.slice(0, idx), titleSlug: slug.slice(idx + 2) };
}

async function signOne(
  admin: ReturnType<typeof createAdminClient>,
  path: string
): Promise<string | null> {
  if (!isSafeImagePath(path)) return null;
  const { data, error } = await admin.storage
    .from(LISTING_PHOTOS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Silence unused warnings if not used.
void signOne;

// ---------------------------------------------------------------- reads

export async function getCategories(): Promise<BrowseCategory[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("categories")
    .select("id, name, slug, icon, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as BrowseCategory[];
}

export type HomeStats = {
  /** Approved seller profiles (soft-delete / inactive excluded). */
  verifiedSellers: number;
  /** Categories that currently have at least one approved listing. */
  liveCategories: number;
  /** Tokens currently held in escrow (booking_hold ledger rows). */
  tokensInEscrow: number;
};

function safeCount(n: number | null | undefined): number {
  const parsed = Math.floor(Number(n));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Real homepage counters. Every value is normalized to a non-negative
 * integer (0, never NaN/undefined) and every query fails soft to 0 so
 * an empty or unreachable database renders "0", not "NaN".
 *
 * Test fixtures (scripts/test-*.mjs) are excluded at the SQL layer so
 * the public counters only ever reflect real marketplace activity —
 * running the test suite must never inflate them.
 */
export async function getHomeStats(): Promise<HomeStats> {
  const admin = createAdminClient();

  // Sellers — approved, active, non-test.
  let sellersQuery = admin
    .from("seller_profiles")
    .select("id", { count: "exact", head: true })
    .is("soft_deleted_at", null)
    .eq("is_active", true);
  for (const pattern of TEST_SELLER_DISPLAY_NAME_PATTERNS) {
    sellersQuery = sellersQuery.not("display_name", "ilike", pattern);
  }

  // Approved, non-test listings — used for the live-category count.
  let listingsQuery = admin
    .from("listings")
    .select("category_id")
    .eq("status", "approved")
    .eq("is_active", true)
    .is("soft_deleted_at", null);
  for (const pattern of TEST_LISTING_TITLE_PATTERNS) {
    listingsQuery = listingsQuery.not("title", pattern.op, pattern.value);
  }

  const [sellersResult, listingsResult, escrowResult] = await Promise.all([
    sellersQuery,
    listingsQuery,
    admin
      .from("ledger_entries")
      .select("amount, ref_id")
      .eq("entry_type", "booking_hold"),
  ]);

  // "Live" categories = distinct categories with ≥ 1 approved listing.
  const liveCategories = new Set(
    (listingsResult.data ?? [])
      .map((row) => row.category_id as string | null)
      .filter((id): id is string => Boolean(id)),
  ).size;

  // Escrow = booking_hold ledger rows whose booking belongs to a
  // non-test listing. Ledger rows carry ref_id = booking id.
  const holds = (escrowResult.data ?? []) as Array<{
    amount: number | null;
    ref_id: string | null;
  }>;
  const bookingIds = [
    ...new Set(holds.map((h) => h.ref_id).filter((id): id is string => Boolean(id))),
  ];
  const testBookingIds = new Set<string>();
  if (bookingIds.length > 0) {
    const { data: bookings } = await admin
      .from("bookings")
      .select("id, listing:listings(title)")
      .in("id", bookingIds);
    for (const booking of (bookings ?? []) as unknown as Array<{
      id: string;
      listing: { title: string | null } | null;
    }>) {
      if (isTestListingTitle(booking.listing?.title)) {
        testBookingIds.add(booking.id);
      }
    }
  }
  const escrowSum = holds.reduce((sum, hold) => {
    if (hold.ref_id && testBookingIds.has(hold.ref_id)) return sum;
    return sum + Number(hold.amount ?? 0);
  }, 0);

  return {
    verifiedSellers: safeCount(sellersResult.count),
    liveCategories: safeCount(liveCategories),
    tokensInEscrow: safeCount(escrowResult.error ? null : escrowSum),
  };
}

type ListingJoinRow = {
  id: string;
  title: string;
  description: string | null;
  price_tokens: number;
  duration_minutes: number;
  status: string;
  created_at: string;
  seller_id: string;
  seller: Omit<BrowseSeller, "presence"> | null;
  category: BrowseCategory | null;
  listing_photos: { id: string; path: string; sort_order: number }[];
};

async function getPresenceMap(
  admin: ReturnType<typeof createAdminClient>,
  sellerIds: string[],
): Promise<Map<string, BrowseSeller["presence"]>> {
  const result = new Map<string, BrowseSeller["presence"]>();
  if (!sellerIds.length) return result;
  const [{ data: profiles }, { data: bookings }] = await Promise.all([
    admin.from("seller_profiles").select("user_id, last_seen_at").in("user_id", sellerIds),
    admin.from("bookings").select("seller_id, status, is_on_demand")
      .in("seller_id", sellerIds).in("status", ["paid", "scheduled", "live"])
      .is("soft_deleted_at", null),
  ]);
  const activeSince = Date.now() - 90_000;
  for (const profile of profiles ?? []) {
    result.set(profile.user_id, profile.last_seen_at && new Date(profile.last_seen_at).getTime() > activeSince ? "available" : "offline");
  }
  for (const booking of bookings ?? []) {
    if (booking.status === "live") result.set(booking.seller_id, "in_call");
    else if (booking.is_on_demand && result.get(booking.seller_id) !== "in_call") result.set(booking.seller_id, "booked");
  }
  return result;
}

async function signAvatars(
  admin: ReturnType<typeof createAdminClient>, paths: Array<string | null>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.all([...new Set(paths.filter(isSafeImagePath))].map(async (path) => {
    const { data } = await admin.storage.from("seller-avatars").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (data?.signedUrl) result.set(path, data.signedUrl);
  }));
  return result;
}

async function fetchApprovedListings(
  admin: ReturnType<typeof createAdminClient>,
  filters: {
    search?: string;
    categoryId?: string;
    sort: BrowseSort;
    limit: number;
    offset: number;
  }
): Promise<{ rows: ListingJoinRow[]; total: number }> {
  let query = admin
    .from("listings")
    .select(
      `id, title, description, price_tokens, duration_minutes, status, created_at, seller_id,
       seller:seller_profiles!inner(user_id, slug, display_name, is_verified, tagline, bio, avatar_url, last_seen_at),
       category:categories(id, name, slug, icon, sort_order),
       listing_photos(id, path, sort_order)`,
      { count: "exact" }
    )
    .eq("status", "approved")
    .eq("is_active", true)
    .eq("seller.is_active", true)
    .is("seller.soft_deleted_at", null)
    .is("soft_deleted_at", null);

  // Hide test fixtures at the SQL layer. Each `not()` clause is
  // AND-ed into the existing filter set, so the count returned by
  // `count: "exact"` already excludes test rows. We still re-filter
  // in `decorateRows` as a safety net for legacy data.
  for (const pattern of TEST_SELLER_DISPLAY_NAME_PATTERNS) {
    query = query.not("seller.display_name", "ilike", pattern);
  }
  for (const pattern of TEST_LISTING_TITLE_PATTERNS) {
    query = query.not("title", pattern.op, pattern.value);
  }

  if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }
  if (filters.search && filters.search.trim()) {
    // ilike on title; case-insensitive substring match.
    const term = `%${filters.search.trim()}%`;
    query = query.ilike("title", term);
  }

  switch (filters.sort) {
    case "price_asc":
      query = query.order("price_tokens", { ascending: true });
      break;
    case "price_desc":
      query = query.order("price_tokens", { ascending: false });
      break;
    case "duration_asc":
      query = query.order("duration_minutes", { ascending: true });
      break;
    case "duration_desc":
      query = query.order("duration_minutes", { ascending: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  query = query.range(filters.offset, filters.offset + filters.limit - 1);

  const { data, count } = await query;
  return { rows: (data ?? []) as unknown as ListingJoinRow[], total: count ?? 0 };
}

async function decorateRows(
  admin: ReturnType<typeof createAdminClient>,
  rows: ListingJoinRow[]
): Promise<BrowseListing[]> {
  if (rows.length === 0) return [];
  // Sign cover paths only (first photo per listing, smallest sort_order).
  const coverPaths: string[] = [];
  for (const r of rows) {
    const sorted = [...(r.listing_photos ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    if (sorted[0]?.path) coverPaths.push(sorted[0].path);
  }
  const signedMap = await _signPhotoPaths(coverPaths);
  const sellerIds = [...new Set(rows.map((r) => r.seller?.user_id).filter((id): id is string => Boolean(id)))];
  const presenceMap = await getPresenceMap(admin, sellerIds);
  const avatarMap = await signAvatars(admin, rows.map((r) => r.seller?.avatar_url ?? null));

  return rows
    // Safety net — if any row slipped past the SQL `not()` filters
    // (e.g. legacy data the SQL pattern doesn't match), drop it
    // here so the public UI never shows test names or titles.
    .filter((r) => !isTestSellerDisplayName(r.seller?.display_name))
    .filter((r) => !isTestListingTitle(r.title))
    .map((r) => {
      const sortedPhotos = [...(r.listing_photos ?? [])].sort(
        (a, b) => a.sort_order - b.sort_order
      );
      const cover = sortedPhotos[0] ? signedMap.get(sortedPhotos[0].path) ?? null : null;
      const seller = r.seller ?? {
        user_id: "",
        slug: "",
        display_name: "—",
        is_verified: false,
        tagline: null,
        bio: null,
        avatar_url: null,
        last_seen_at: null,
      };
      return {
        id: r.id,
        slug: makeListingSlug(seller.slug, r.title),
        title: r.title,
        price_tokens: r.price_tokens,
        duration_minutes: r.duration_minutes,
        cover,
        seller: {
          user_id: seller.user_id,
          slug: seller.slug,
          display_name: seller.display_name,
          is_verified: !!seller.is_verified,
          tagline: seller.tagline ?? null,
          bio: seller.bio ?? null,
          avatar_url: seller.avatar_url ? avatarMap.get(seller.avatar_url) ?? null : null,
          last_seen_at: seller.last_seen_at,
          presence: presenceMap.get(seller.user_id) ?? "offline",
        },
        category: r.category ?? null,
        created_at: r.created_at,
      } satisfies BrowseListing;
    });
}

export async function listBrowseListings(filters: BrowseFilters): Promise<{
  rows: BrowseListing[];
  total: number;
}> {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(filters.limit ?? 24, 1), 60);
  const offset = Math.max(filters.offset ?? 0, 0);
  const sort: BrowseSort = filters.sort ?? "newest";

  let categoryId: string | undefined;
  if (filters.categorySlug) {
    const { data: catRow } = await admin
      .from("categories")
      .select("id")
      .eq("slug", filters.categorySlug)
      .eq("is_active", true)
      .maybeSingle();
    categoryId = catRow?.id;
    if (!categoryId) return { rows: [], total: 0 };
  }

  const { rows, total } = await fetchApprovedListings(admin, {
    search: filters.search,
    categoryId,
    sort,
    limit,
    offset,
  });
  const decorated = await decorateRows(admin, rows);
  // `total` already reflects the SQL-layer test filters; if the
  // safety-net filter dropped more rows, surface the post-filter
  // length so the browse page doesn't promise results that aren't
  // coming back.
  const visibleTotal = decorated.length === rows.length
    ? total
    : Math.max(total - (rows.length - decorated.length), decorated.length);
  return { rows: decorated, total: visibleTotal };
}

export async function getFeaturedListings(
  limit = 8
): Promise<BrowseListing[]> {
  const { rows } = await listBrowseListings({ sort: "newest", limit });
  return rows.slice(0, limit);
}

async function getListingBySlugUncached(slug: string): Promise<BrowseListingDetail | null> {
  const parts = splitListingSlug(slug);
  if (!parts) return null;
  const admin = createAdminClient();

  // Find the seller first (cheap, unique lookup).
  const { data: sellerRow } = await admin
    .from("seller_profiles")
    .select("id, user_id, slug, display_name, is_verified, tagline, bio, avatar_url, last_seen_at, is_active, soft_deleted_at")
    .eq("slug", parts.sellerSlug)
    .maybeSingle();
  if (!sellerRow || !sellerRow.is_active || sellerRow.soft_deleted_at) {
    return null;
  }

  // Find an approved listing by this seller whose title-slug matches.
  const { data: candidates } = await admin
    .from("listings")
    .select("id, title, description, price_tokens, duration_minutes, status, created_at, seller_id, category_id, soft_deleted_at")
    .eq("seller_id", sellerRow.id)
    .eq("status", "approved")
    .eq("is_active", true)
    .is("soft_deleted_at", null);

  const matched = (candidates ?? []).find(
    (l) => makeListingSlug(parts.sellerSlug, l.title) === slug
  );
  if (!matched) return null;

  const [{ data: photos }, { data: category }, presenceMap, avatarMap] = await Promise.all([
    admin
      .from("listing_photos")
      .select("id, path, sort_order")
      .eq("listing_id", matched.id)
      .order("sort_order"),
    matched.category_id
      ? admin
          .from("categories")
          .select("id, name, slug, icon, sort_order")
          .eq("id", matched.category_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getPresenceMap(admin, [sellerRow.user_id]),
    signAvatars(admin, [sellerRow.avatar_url]),
  ]);

  const photoList = (photos ?? []).map((p) => ({
    id: p.id,
    path: p.path,
    sort_order: p.sort_order,
  }));
  const paths = photoList.map((p) => p.path);
  const signed = await _signPhotoPaths(paths);
  const decoratedPhotos = photoList.map((p) => ({
    id: p.id,
    sort_order: p.sort_order,
    url: signed.get(p.path) ?? null,
  }));

  // Cover from the lowest sort_order photo.
  const sortedByOrder = [...decoratedPhotos].sort(
    (a, b) => a.sort_order - b.sort_order
  );
  const cover = sortedByOrder[0]?.url ?? null;

  return {
    id: matched.id,
    slug,
    title: matched.title,
    description: matched.description,
    price_tokens: matched.price_tokens,
    duration_minutes: matched.duration_minutes,
    cover,
    seller: {
      user_id: sellerRow.user_id,
      slug: sellerRow.slug,
      display_name: sellerRow.display_name,
      is_verified: !!sellerRow.is_verified,
      tagline: sellerRow.tagline ?? null,
      bio: sellerRow.bio ?? null,
      avatar_url: sellerRow.avatar_url ? avatarMap.get(sellerRow.avatar_url) ?? null : null,
      last_seen_at: sellerRow.last_seen_at,
      presence: presenceMap.get(sellerRow.user_id) ?? "offline",
    },
    category: (category as BrowseCategory | null) ?? null,
    created_at: matched.created_at,
    photos: sortedByOrder,
  } satisfies BrowseListingDetail;
}

export { signOne as signSinglePhotoPath };

export const getListingBySlug = cache(getListingBySlugUncached);
