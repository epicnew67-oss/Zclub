"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  cancelPayoutRequest,
  requestPayout,
  type CancelPayoutResult,
  type RequestPayoutResult,
} from "@/lib/post-call-money";

/**
 * Wallet server actions — payout requests only. Top-ups already have
 * their own action surface under /wallet/topup. The RPCs are the gate
 * (security definer + role check + idempotency); these thin wrappers
 * just confirm auth and revalidate the wallet page on success.
 */

export async function requestPayoutAction(
  amount: number
): Promise<RequestPayoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_a_seller" };

  const result = await requestPayout(amount);
  if (result.ok) {
    revalidatePath("/wallet");
    revalidatePath("/finance/payouts");
  }
  return result;
}

export async function cancelPayoutAction(id: string): Promise<CancelPayoutResult> {
  if (!id) return { ok: false, code: "not_found" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_owner" };

  const result = await cancelPayoutRequest(id);
  if (result.ok) {
    revalidatePath("/wallet");
  }
  return result;
}