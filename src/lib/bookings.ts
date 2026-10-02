/**
 * Server-only helpers for the purchasing flow.
 *
 * Thin typed wrappers around the booking RPCs (`purchase_slot`,
 * `cancel_booking`, `mark_no_show_refund`, `send_chat_message`). The
 * RPCs run in a single transaction server-side; we just unwrap the
 * structured jsonb result and surface it to the server actions.
 *
 * The list / detail reads (`listBuyerOrders`, `listSellerOrders`,
 * `getOrderForUser`) are admin-client reads that join the booking,
 * slot, listing, and profile tables. RLS still gates the client side;
 * the admin client is used only because we sign photo paths in the same
 * query when needed (we don't here, but it keeps the read pattern
 * uniform with `src/lib/browse.ts`).
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeListingSlug } from "@/lib/browse";

export type PurchaseResult =
  | { ok: true; bookingId: string; chatId: string }
  | { ok: false; code: "INSUFFICIENT_BALANCE"; have: number; need: number; shortfall: number }
  | { ok: false; code: "slot_already_taken" }
  | { ok: false; code: "purchase_failed" }
  | {
      ok: false;
      code:
        | "slot_not_found"
        | "slot_not_open"
        | "slot_in_past"
        | "listing_unavailable"
        | "cannot_self_book";
    };

export type CancelResult =
  | { ok: true; role: "buyer" | "seller"; refundedBuyer: number; releasedSeller: number }
  | { ok: false; code: "not_found" | "not_participant" | "already_finalized" | "too_late" };

export type NoShowResult =
  | { ok: true; noop?: boolean }
  | { ok: false; code: "not_found" | "already_finalized" | "too_early" };

export type SendMessageResult =
  | { ok: true; message: { id: number; chatId: string; senderId: string; body: string; createdAt: string } }
  | { ok: false; code: "rate_limited" | "empty" | "not_participant" };

export type OrderRow = {
  id: string;
  listingTitle: string;
  listingSlug: string | null;
  priceTokens: number;
  status: string;
  slotStart: string;
  slotEnd: string;
  counterparty: { displayName: string; slug: string | null };
};

export type OrderDetail = {
  id: string;
  status: string;
  priceTokens: number;
  createdAt: string;
  slot: { startsAt: string; endsAt: string };
  listing: { id: string; title: string; slug: string };
  buyer: { id: string; displayName: string };
  seller: { id: string; displayName: string; slug: string | null };
  chatId: string;
  role: "buyer" | "seller";
};

type PurchaseRpcRow = {
  ok: boolean;
  code?: string;
  have?: number;
  need?: number;
  shortfall?: number;
  booking_id?: string;
  chat_id?: string;
};

type CancelRpcRow = {
  ok: boolean;
  code?: string;
  role?: "buyer" | "seller";
  refunded_buyer?: number;
  released_seller?: number;
};

type NoShowRpcRow = {
  ok: boolean;
  code?: string;
  noop?: boolean;
};

type ChatMessageRpcRow = {
  id: number;
  chat_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function rpcErrorAsCode(message: string | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (trimmed.startsWith("send_chat_message: rate_limited")) return "rate_limited";
  if (trimmed.startsWith("send_chat_message: empty body")) return "empty";
  if (trimmed.startsWith("send_chat_message: not a participant")) return "not_participant";
  return null;
}

// ---------------------------------------------------------------- purchase

/**
 * Buy a slot. Uses the USER's session client: purchase_slot reads
 * auth.uid() as the buyer, so the service client (which has no user)
 * always raised "sign in required" — surfacing as the generic
 * "purchase failed" toast for every booking.
 */
export async function purchaseSlot(slotId: string): Promise<PurchaseResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_slot", {
    _slot_id: slotId,
  } as never);
  if (error) {
    const insuff = error.message.match(
      /INSUFFICIENT_BALANCE have=(\d+), need=(\d+), shortfall=(\d+)/
    );
    if (insuff) {
      return {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        have: Number(insuff[1]),
        need: Number(insuff[2]),
        shortfall: Number(insuff[3]),
      };
    }
    return { ok: false, code: "purchase_failed" };
  }
  const row = (data ?? {}) as PurchaseRpcRow;
  if (row.ok && row.booking_id && row.chat_id) {
    return { ok: true, bookingId: row.booking_id, chatId: row.chat_id };
  }
  switch (row.code) {
    case "INSUFFICIENT_BALANCE":
      return {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        have: row.have ?? 0,
        need: row.need ?? 0,
        shortfall: row.shortfall ?? 0,
      };
    case "slot_already_taken":
      return { ok: false, code: "slot_already_taken" };
    case "slot_not_found":
    case "slot_not_open":
    case "slot_in_past":
    case "listing_unavailable":
    case "cannot_self_book":
      return { ok: false, code: row.code as "slot_not_found" };
    default:
      return { ok: false, code: "listing_unavailable" };
  }
}

// ---------------------------------------------------------------- cancel

export async function cancelBooking(bookingId: string): Promise<CancelResult> {
  // cancel_booking resolves the role from auth.uid() — session client.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_booking", {
    _booking_id: bookingId,
  } as never);
  if (error) return { ok: false, code: "not_found" };
  const row = (data ?? {}) as CancelRpcRow;
  if (row.ok && row.role) {
    return {
      ok: true,
      role: row.role,
      refundedBuyer: row.refunded_buyer ?? 0,
      releasedSeller: row.released_seller ?? 0,
    };
  }
  switch (row.code) {
    case "not_participant":
    case "already_finalized":
    case "too_late":
    case "not_found":
      return { ok: false, code: row.code };
    default:
      return { ok: false, code: "not_found" };
  }
}

// ---------------------------------------------------------------- no-show

export async function markNoShowRefund(bookingId: string): Promise<NoShowResult> {
  // mark_no_show_refund checks participation via auth.uid().
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_no_show_refund", {
    _booking_id: bookingId,
  } as never);
  if (error) return { ok: false, code: "not_found" };
  const row = (data ?? {}) as NoShowRpcRow;
  if (row.ok) return { ok: true, noop: row.noop };
  switch (row.code) {
    case "too_early":
    case "already_finalized":
    case "not_found":
      return { ok: false, code: row.code };
    default:
      return { ok: false, code: "not_found" };
  }
}

// ---------------------------------------------------------------- chat

export async function sendChatMessage(
  chatId: string,
  body: string
): Promise<SendMessageResult> {
  // send_chat_message stamps the sender from auth.uid().
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_chat_message", {
    _chat_id: chatId,
    _body: body,
  } as never);
  if (error) {
    const code = rpcErrorAsCode(error.message);
    if (code) return { ok: false, code: code as SendMessageResult extends { ok: false; code: infer C } ? C : never };
    return { ok: false, code: "not_participant" };
  }
  const row = data as ChatMessageRpcRow;
  return {
    ok: true,
    message: {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: row.created_at,
    },
  };
}

// ---------------------------------------------------------------- lists

/**
 * Listings have NO slug column — a listing's public slug is derived
 * (`sellerSlug--titleSlug`, see browse.makeListingSlug). Selecting
 * `listings.slug` makes PostgREST fail the whole query (42703), so the
 * slug is attached here after the fact.
 */
async function attachListingSlugs<T extends { seller_id: string; listing: unknown }>(
  rows: T[]
): Promise<Array<T & { listing_slug: string | null }>> {
  const sellerIds = [...new Set(rows.map((r) => r.seller_id))];
  const slugByUser = new Map<string, string>();
  if (sellerIds.length > 0) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("seller_profiles")
      .select("user_id, slug")
      .in("user_id", sellerIds);
    for (const s of data ?? []) {
      slugByUser.set(s.user_id as string, s.slug as string);
    }
  }
  return rows.map((row) => {
    const title =
      firstOrNull(row.listing as { title: string } | { title: string }[] | null)
        ?.title ?? "";
    const sellerSlug = slugByUser.get(row.seller_id) ?? "";
    return {
      ...row,
      listing_slug:
        title && sellerSlug ? makeListingSlug(sellerSlug, title) : null,
    };
  });
}

export async function listBuyerOrders(userId: string): Promise<OrderRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(
      `id, status, price_tokens, created_at, seller_id,
       slot:availability_slots(starts_at, ends_at),
       listing:listings(title),
       seller:profiles!bookings_seller_id_fkey(id, display_name)`
    )
    .eq("buyer_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  const rows = await attachListingSlugs((data ?? []) as RawBooking[]);
  return rows.map((r) => normalizeOrderRow(r, "buyer"));
}

export async function listSellerOrders(userId: string): Promise<OrderRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(
      `id, status, price_tokens, created_at, seller_id,
       slot:availability_slots(starts_at, ends_at),
       listing:listings(title),
       buyer:profiles!bookings_buyer_id_fkey(id, display_name)`
    )
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  const rows = await attachListingSlugs((data ?? []) as RawBooking[]);
  return rows.map((r) => normalizeOrderRow(r, "seller"));
}

type RawBooking = {
  id: string;
  status: string;
  price_tokens: number;
  created_at: string;
  seller_id: string;
  listing_slug?: string | null;
  slot: { starts_at: string; ends_at: string } | { starts_at: string; ends_at: string }[] | null;
  listing: { title: string } | { title: string }[] | null;
  seller?: { display_name: string } | { display_name: string }[] | null;
  buyer?: { id: string; display_name: string } | { id: string; display_name: string }[] | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function normalizeOrderRow(row: RawBooking, role: "buyer" | "seller"): OrderRow {
  const slot = firstOrNull(row.slot);
  const listing = firstOrNull(row.listing);
  const counterpartySeller = firstOrNull(row.seller);
  const counterpartyBuyer = firstOrNull(row.buyer);
  const counterparty =
    role === "buyer"
      ? {
          displayName: counterpartySeller?.display_name ?? "Seller",
          slug: null as string | null,
        }
      : {
          displayName: counterpartyBuyer?.display_name ?? "Buyer",
          slug: null as string | null,
        };
  return {
    id: row.id,
    listingTitle: listing?.title ?? "Listing",
    listingSlug: row.listing_slug ?? null,
    priceTokens: row.price_tokens,
    status: row.status,
    slotStart: slot?.starts_at ?? row.created_at,
    slotEnd: slot?.ends_at ?? row.created_at,
    counterparty,
  };
}

// ---------------------------------------------------------------- detail

export async function getOrderForUser(
  bookingId: string,
  userId: string
): Promise<OrderDetail | null> {
  const admin = createAdminClient();
  // Fetch the booking row + both participants as profiles (bookings.seller_id
  // references profiles, not seller_profiles) + the listing + slot.
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      `id, buyer_id, seller_id, listing_id, slot_id, price_tokens, status, created_at,
       slot:availability_slots(starts_at, ends_at),
       listing:listings(id, title),
       buyer:profiles!bookings_buyer_id_fkey(id, display_name),
       seller:profiles!bookings_seller_id_fkey(id, display_name)`
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !booking) return null;
  if (booking.buyer_id !== userId && booking.seller_id !== userId) return null;

  const { data: chat } = await admin
    .from("booking_chats")
    .select("id")
    .eq("booking_id", booking.id)
    .maybeSingle();
  if (!chat) return null;

  // Pull the seller_profile (if any) for the slug.
  const { data: sp } = await admin
    .from("seller_profiles")
    .select("slug, user_id")
    .eq("user_id", booking.seller_id)
    .maybeSingle();

  const sellerProfile = booking.seller as unknown as
    | { id: string; display_name: string }
    | { id: string; display_name: string }[]
    | null;
  const buyerProfile = booking.buyer as unknown as
    | { id: string; display_name: string }
    | { id: string; display_name: string }[]
    | null;
  const slot = booking.slot as unknown as
    | { starts_at: string; ends_at: string }
    | { starts_at: string; ends_at: string }[]
    | null;
  const listing = booking.listing as unknown as
    | { id: string; title: string }
    | { id: string; title: string }[]
    | null;
  const sellerRow = firstOrNull(sellerProfile);
  const buyerRow = firstOrNull(buyerProfile);
  const slotRow = firstOrNull(slot);
  const listingRow = firstOrNull(listing);

  return {
    id: booking.id,
    status: booking.status,
    priceTokens: booking.price_tokens,
    createdAt: booking.created_at,
    slot: {
      startsAt: slotRow?.starts_at ?? booking.created_at,
      endsAt: slotRow?.ends_at ?? booking.created_at,
    },
    listing: {
      id: listingRow?.id ?? booking.listing_id,
      title: listingRow?.title ?? "Listing",
      // Derived slug (listings has no slug column).
      slug:
        listingRow?.title && sp?.slug
          ? makeListingSlug(sp.slug, listingRow.title)
          : "",
    },
    buyer: {
      id: booking.buyer_id,
      displayName: buyerRow?.display_name ?? "Buyer",
    },
    seller: {
      id: booking.seller_id,
      displayName: sellerRow?.display_name ?? "Seller",
      slug: sp?.slug ?? null,
    },
    chatId: chat.id,
    role: booking.buyer_id === userId ? "buyer" : "seller",
  };
}

export async function listChatMessages(chatId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("booking_messages")
    .select("id, sender_id, body, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(500);
  return (data ?? []).map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: r.created_at,
  }));
}
