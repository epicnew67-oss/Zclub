"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  approvePayout,
  markPayoutPaid,
  rejectPayout,
  type ApprovePayoutResult,
  type MarkPayoutPaidResult,
  type RejectPayoutResult,
} from "@/lib/post-call-money";

/**
 * Finance actions for the payout queue. Role check (finance / owner)
 * happens inside the RPC; these wrappers confirm a session exists and
 * revalidate the page on success.
 */

export async function approvePayoutAction(
  id: string
): Promise<ApprovePayoutResult> {
  if (!id) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "wrong_state" };

  const result = await approvePayout(id);
  if (result.ok) {
    revalidatePath("/finance/payouts");
    revalidatePath("/wallet");
  }
  return result;
}

export async function rejectPayoutAction(
  id: string,
  note: string
): Promise<RejectPayoutResult> {
  if (!id) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "wrong_state" };

  const result = await rejectPayout(id, note);
  if (result.ok) {
    revalidatePath("/finance/payouts");
    revalidatePath("/wallet");
  }
  return result;
}

export async function markPayoutPaidAction(
  id: string,
  paymentReference: string
): Promise<MarkPayoutPaidResult> {
  if (!id) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "wrong_state" };

  const result = await markPayoutPaid(id, paymentReference);
  if (result.ok) {
    revalidatePath("/finance/payouts");
    revalidatePath("/wallet");
  }
  return result;
}