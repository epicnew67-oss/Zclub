"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Defence-in-depth bounds applied at the action layer so the RPC
// never sees pathological input. The RPCs have their own checks
// (reason length, status guards) but a hardened client is cheaper
// than a slow RPC.
const MAX_NOTE_LEN = 500;
const MAX_REASON_LEN = 500;

export async function financeApproveTopupAction(topupId: string, note?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required." } as const;

  const trimmedNote =
    note && note.trim().length > 0 ? note.trim().slice(0, MAX_NOTE_LEN) : null;

  const { data, error } = await supabase.rpc("finance_approve_topup", {
    _topup_id: topupId,
    _note: trimmedNote,
  });

  if (error) {
    return { error: error.message } as const;
  }

  revalidatePath("/finance/topups");
  revalidatePath("/wallet");
  return { data } as const;
}

export async function financeRejectTopupAction(topupId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { error: "A reason is required to reject." } as const;
  }
  if (trimmed.length > MAX_REASON_LEN) {
    return {
      error: `Reason must be ${MAX_REASON_LEN} characters or fewer.`,
    } as const;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required." } as const;

  const { data, error } = await supabase.rpc("finance_reject_topup", {
    _topup_id: topupId,
    _reason: trimmed,
  });

  if (error) {
    return { error: error.message } as const;
  }

  revalidatePath("/finance/topups");
  revalidatePath("/wallet");
  return { data } as const;
}
