import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------- types

export type PayoutStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";

export type SellerWalletSummary = {
  user_id: string;
  balance: number;
  available: number;
  in_escrow: number;
  pending_payout: number;
  approved_payout: number;
  paid_payout: number;
};

export type OpenDisputeResult =
  | { ok: true; dispute_id: string; booking_id: string }
  | { ok: false; code: string; status?: string; dispute_id?: string };

export type ReleaseEscrowResult =
  | {
      ok: true;
      booking_id: string;
      seller_credit?: number;
      commission_pct?: number;
      commission_tokens?: number;
      already_released?: boolean;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "wrong_state"
        | "frozen_dispute"
        | "no_live_ended_at"
        | "window_not_elapsed";
      status?: string;
      dispute_id?: string;
      releasable_at?: string;
    };

export type ResolveDisputeResult =
  | {
      ok: true;
      booking_id: string;
      outcome: "refund_buyer" | "release_seller" | "split";
      buyer_credit: number;
      seller_credit: number;
      commission_pct: number;
      dispute_id: string;
    }
  | { ok: false; code: string };

export type RequestPayoutResult =
  | {
      ok: true;
      payout_id: string;
      amount: number;
      available_after: number;
    }
  | {
      ok: false;
      code:
        | "not_a_seller"
        | "bad_amount"
        | "below_min"
        | "INSUFFICIENT_AVAILABLE";
      min?: number;
      have?: number;
      need?: number;
    };

export type CancelPayoutResult =
  | { ok: true; payout_id: string }
  | { ok: false; code: string; status?: string };

export type ApprovePayoutResult =
  | { ok: true; payout_id: string }
  | { ok: false; code: string; status?: string };

export type RejectPayoutResult =
  | { ok: true; payout_id: string }
  | { ok: false; code: string };

export type MarkPayoutPaidResult =
  | {
      ok: true;
      payout_id: string;
      tokens?: number;
      payment_reference?: string;
      already_paid?: boolean;
    }
  | { ok: false; code: string; status?: string };

// ---------------------------------------------------------------- public API
//
// Money / state writes funnel through SECURITY DEFINER RPCs. RPCs that
// resolve the actor from auth.uid() (disputes, payouts, bookings chat)
// must be called with the USER's session client — calling them with the
// service client means "no user", and they fail their permission checks.
// The admin client remains for service-role jobs (lists, sweep, escrow
// release) that take explicit ids instead of a session.
//

export async function openDispute(
  bookingId: string,
  reason: string
): Promise<OpenDisputeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_dispute", {
    _booking_id: bookingId,
    _reason: reason,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as OpenDisputeResult;
}

export async function releaseEscrow(
  bookingId: string
): Promise<ReleaseEscrowResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_escrow", {
    _booking_id: bookingId,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "not_found" }) as ReleaseEscrowResult;
}

export async function resolveDispute(
  bookingId: string,
  outcome: "refund_buyer" | "release_seller" | "split",
  note: string,
  refundPct?: number
): Promise<ResolveDisputeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_dispute", {
    _booking_id: bookingId,
    _outcome: outcome,
    _note: note,
    _refund_pct: refundPct ?? null,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as ResolveDisputeResult;
}

export async function requestPayout(amount: number): Promise<RequestPayoutResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_payout", {
    _amount: amount,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as RequestPayoutResult;
}

export async function cancelPayoutRequest(id: string): Promise<CancelPayoutResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_payout_request", {
    _id: id,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as CancelPayoutResult;
}

export async function approvePayout(id: string): Promise<ApprovePayoutResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_payout", {
    _id: id,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as ApprovePayoutResult;
}

export async function rejectPayout(
  id: string,
  note: string
): Promise<RejectPayoutResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reject_payout", {
    _id: id,
    _note: note,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as RejectPayoutResult;
}

export async function markPayoutPaid(
  id: string,
  paymentReference: string
): Promise<MarkPayoutPaidResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_payout_paid", {
    _id: id,
    _payment_reference: paymentReference,
  } as never);
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as MarkPayoutPaidResult;
}

export async function getSellerWalletSummary(
  userId: string
): Promise<SellerWalletSummary> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_seller_wallet_summary", {
    _user_id: userId,
  } as never);
  if (error) throw error;
  return data as SellerWalletSummary;
}

// ---------------------------------------------------------------- queries
//
// These are simple admin reads used by the seller wallet, finance, and
// admin disputes pages. RLS is already permissive enough on the
// underlying tables that we don't strictly need the admin client, but
// using it here keeps the read paths consistent with the rest of the
// server lib surface and lets the pages bypass the projection policy
// differences between `payout_requests` (owner-only) and
// `disputes` (participant-only).

export type PayoutRow = {
  id: string;
  seller_id: string;
  tokens: number;
  status: PayoutStatus;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  processed_at: string | null;
  payment_reference: string | null;
  created_at: string;
};

export async function listSellerPayouts(userId: string): Promise<PayoutRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payout_requests")
    .select(
      "id, seller_id, tokens, status, note, reviewed_by, reviewed_at, processed_at, payment_reference, created_at"
    )
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as PayoutRow[];
}

export async function listAllPayoutsForFinance(
  statuses: PayoutStatus[] = ["pending"]
): Promise<PayoutRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payout_requests")
    .select(
      "id, seller_id, tokens, status, note, reviewed_by, reviewed_at, processed_at, payment_reference, created_at"
    )
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PayoutRow[];
}

export type DisputeRow = {
  id: string;
  booking_id: string;
  opened_by: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export async function listOpenDisputesForAdmin(): Promise<DisputeRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("disputes")
    .select(
      "id, booking_id, opened_by, reason, status, resolution_note, resolved_by, resolved_at, created_at"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as DisputeRow[];
}

export async function listAllDisputesForAdmin(): Promise<DisputeRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("disputes")
    .select(
      "id, booking_id, opened_by, reason, status, resolution_note, resolved_by, resolved_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as DisputeRow[];
}

export async function getDisputeForBooking(
  bookingId: string
): Promise<DisputeRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("disputes")
    .select(
      "id, booking_id, opened_by, reason, status, resolution_note, resolved_by, resolved_at, created_at"
    )
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DisputeRow | null;
}

export async function listBookingMessagesForDispute(
  chatId: string
): Promise<
  { id: string; chat_id: string; sender_id: string; body: string; created_at: string }[]
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_messages")
    .select("id, chat_id, sender_id, body, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    chat_id: string;
    sender_id: string;
    body: string;
    created_at: string;
  }[];
}

/**
 * Fetch everything the admin disputes page needs for a single booking:
 * the booking row + slot + both profiles + chat id + open dispute row.
 * Returns null when the booking is missing.
 */
export type DisputeBookingBundle = {
  booking: {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    slot_id: string;
    price_tokens: number;
    status: string;
    created_at: string;
    released_at: string | null;
    dispute_opened_at: string | null;
    live_ended_at: string | null;
  };
  slot: { id: string; starts_at: string; ends_at: string };
  listing: { id: string; title: string; slug: string };
  buyer: { id: string; display_name: string };
  seller: { id: string; display_name: string; slug: string | null };
  chatId: string | null;
  dispute: DisputeRow | null;
};

export async function getDisputeBookingBundle(
  bookingId: string
): Promise<DisputeBookingBundle | null> {
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      "id, buyer_id, seller_id, listing_id, slot_id, price_tokens, status, created_at, released_at, dispute_opened_at, live_ended_at"
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;

  const [slotRes, listingRes, buyerRes, sellerRes, chatRes, disputeRes] =
    await Promise.all([
      admin
        .from("availability_slots")
        .select("id, starts_at, ends_at")
        .eq("id", booking.slot_id)
        .maybeSingle(),
      admin
        .from("listings")
        .select("id, title, slug")
        .eq("id", booking.listing_id)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("id, display_name")
        .eq("id", booking.buyer_id)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("id, display_name")
        .eq("id", booking.seller_id)
        .maybeSingle(),
      admin
        .from("booking_chats")
        .select("id")
        .eq("booking_id", bookingId)
        .maybeSingle(),
      getDisputeForBooking(bookingId),
    ]);

  let sellerSlug: string | null = null;
  if (sellerRes.data) {
    const sp = await admin
      .from("seller_profiles")
      .select("slug")
      .eq("user_id", sellerRes.data.id)
      .maybeSingle();
    sellerSlug = (sp.data?.slug as string | null) ?? null;
  }

  return {
    booking,
    slot: slotRes.data ?? { id: booking.slot_id, starts_at: "", ends_at: "" },
    listing: listingRes.data ?? {
      id: booking.listing_id,
      title: "—",
      slug: "",
    },
    buyer: buyerRes.data ?? { id: booking.buyer_id, display_name: "—" },
    seller: {
      ...(sellerRes.data ?? { id: booking.seller_id, display_name: "—" }),
      slug: sellerSlug,
    },
    chatId: chatRes.data?.id ?? null,
    dispute: disputeRes,
  };
}
