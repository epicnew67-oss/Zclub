"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setUserBan, softDeleteUser, walletAdjust } from "@/lib/admin";

type CustomerAction = "credit" | "ban" | "unban" | "remove";
type ActionResult = { ok: true; message: string } | { ok: false; error: string };
const messages: Record<string, string> = {
  cannot_ban_self: "You cannot ban your own account.",
  cannot_delete_self: "You cannot remove your own account.",
  not_found: "This account could not be found.",
  escrow_pending: "Finish this member's open orders and withdrawals before removing the account.",
  pending_topups: "Review this member's pending payments before removing the account.",
  note_too_short: "Enter a reason of at least 10 characters.",
  no_wallet: "This member does not have a wallet yet.",
  bad_amount: "Enter a positive whole number of tokens.",
};

export async function manageCustomerAction(input: { userId: string; action: CustomerAction; amount?: number; reason?: string }): Promise<ActionResult> {
  if (!input || !/^[0-9a-f-]{36}$/i.test(input.userId) || !["credit", "ban", "unban", "remove"].includes(input.action)) return { ok: false, error: "Invalid account action." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to manage members." };
  const [{ data: owner }, { data: support }] = await Promise.all([
    supabase.rpc("user_has_role", { _role: "owner" }),
    supabase.rpc("user_has_role", { _role: "support" }),
  ]);
  if (!owner && (input.action === "credit" || !support)) return { ok: false, error: "You do not have permission for this action." };
  const reason = (input.reason ?? "").trim();
  if (input.action === "credit" && (!Number.isInteger(input.amount) || input.amount! < 1 || input.amount! > 2147483647)) return { ok: false, error: "Enter a positive whole number of tokens." };
  if (input.action === "credit" && (reason.length < 10 || reason.length > 500)) return { ok: false, error: "Enter a reason between 10 and 500 characters." };
  try {
    const result = input.action === "credit" ? await walletAdjust(input.userId, input.amount!, reason)
      : input.action === "remove" ? await softDeleteUser(input.userId)
      : await setUserBan(input.userId, input.action === "ban", reason.slice(0, 500) || null);
    if (!result.ok) return { ok: false, error: messages[result.code] ?? "The action could not be completed. Refresh and try again." };
    revalidatePath("/admin/customers");
    revalidatePath("/browse");
    revalidatePath("/");
    const message = input.action === "credit" ? `${input.amount!.toLocaleString()} tokens added.` : input.action === "remove" ? "Account removed. Transaction records are preserved." : input.action === "ban" ? "Member banned." : "Ban removed.";
    return { ok: true, message };
  } catch {
    return { ok: false, error: "Could not confirm this change. Refresh the member's details before trying again." };
  }
}
