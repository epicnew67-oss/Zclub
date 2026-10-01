"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  cancelBooking,
  purchaseSlot,
  sendChatMessage,
  type PurchaseResult,
  type CancelResult,
  type SendMessageResult,
} from "@/lib/bookings";
import { openDispute as openDisputeRpc } from "@/lib/post-call-money";
import type { OpenDisputeResult } from "@/lib/post-call-money";
import { alertNewDispute } from "@/lib/admin-alerts";

/**
 * Server actions called from the buy panel + order chat.
 *
 * Each action authenticates via the user's session cookie (RLS is the
 * gate for `cancel_booking` + `send_chat_message`) and delegates to
 * the server-only RPC wrappers in src/lib/bookings.ts. Results are
 * returned as-is; the client uses the structured `code` to render the
 * right UX (toast, redirect, inline error).
 */

export async function purchaseSlotAction(slotId: string): Promise<PurchaseResult> {
  if (!slotId) return { ok: false, code: "slot_not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "slot_not_found" };

  const result = await purchaseSlot(slotId);
  if (result.ok) {
    revalidatePath("/orders");
    revalidatePath(`/orders/${result.bookingId}`);
  }
  return result;
}

export async function cancelBookingAction(bookingId: string): Promise<CancelResult> {
  if (!bookingId) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_participant" };

  const result = await cancelBooking(bookingId);
  if (result.ok) {
    revalidatePath("/orders");
    revalidatePath(`/orders/${bookingId}`);
    revalidatePath("/seller/orders");
  }
  return result;
}

export async function sendChatMessageAction(
  chatId: string,
  body: string
): Promise<SendMessageResult> {
  if (!chatId) return { ok: false, code: "not_participant" };
  if (typeof body !== "string") return { ok: false, code: "empty" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_participant" };

  return sendChatMessage(chatId, body);
}

export async function openDisputeAction(
  bookingId: string,
  reason: string
): Promise<OpenDisputeResult> {
  if (!bookingId) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_participant" };

  const result = await openDisputeRpc(bookingId, reason);
  if (result.ok) {
    revalidatePath(`/orders/${bookingId}`);
    void alertNewDispute({
      bookingId,
      openedBy: user.email ?? user.id.slice(0, 8),
      reason,
    }).catch((err) => console.warn("[dispute] admin alert failed", err));
  }
  return result;
}
