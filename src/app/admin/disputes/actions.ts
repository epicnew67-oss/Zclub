"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  resolveDispute,
  type ResolveDisputeResult,
} from "@/lib/post-call-money";

/**
 * Admin dispute resolver action. Role check (support / finance / owner)
 * happens inside `resolve_dispute`; this wrapper confirms a session and
 * revalidates the admin disputes page + the affected order page.
 */

export async function resolveDisputeAction(
  bookingId: string,
  outcome: "refund_buyer" | "release_seller" | "split",
  note: string,
  refundPct?: number
): Promise<ResolveDisputeResult> {
  if (!bookingId) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "wrong_state" };

  const result = await resolveDispute(bookingId, outcome, note, refundPct);
  if (result.ok) {
    revalidatePath("/admin/disputes");
    revalidatePath(`/orders/${bookingId}`);
    revalidatePath("/wallet");
  }
  return result;
}