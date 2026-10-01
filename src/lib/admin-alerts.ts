/**
 * Admin / finance alert fan-out.
 *
 * Three events trigger OS-level push + an in-app notification row for
 * every role-holder: new top-up request, new dispute, new seller
 * application. The in-app notification goes through the SQL helper
 * `notify_role(...)` (single transaction, idempotent within 5 minutes
 * for the same title+link so retries don't duplicate). The web push
 * fan-out is best-effort and silently skips when VAPID is not
 * configured.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fanoutPushToRoles, type PushFanoutResult } from "@/lib/push";

const ADMIN_ROLES = ["support", "finance", "owner"] as const;

export type AdminAlertResult = {
  notifications: number;
  push: PushFanoutResult;
};

async function notifyRoles(
  type: "system" | "dispute" | "payout",
  title: string,
  body: string,
  link: string | null,
  roles: readonly string[] = ADMIN_ROLES
): Promise<AdminAlertResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("notify_role", {
    _roles: roles,
    _type: type,
    _title: title,
    _body: body,
    _link: link,
  });
  const notifications = error ? 0 : Number(data ?? 0);
  const push = await fanoutPushToRoles([...roles], { title, body, link: link ?? "/notifications", tag: type });
  return { notifications, push };
}

export async function alertNewTopup(input: {
  topupId: string;
  amountPkr: number;
  tokens: number;
  method: string;
  buyerEmail: string;
}): Promise<AdminAlertResult> {
  return notifyRoles(
    "system",
    "New top-up request",
    `${input.method} — ${input.amountPkr.toLocaleString()} PKR for ${input.tokens.toLocaleString()} tokens (${input.buyerEmail})`,
    `/finance/topups?id=${input.topupId}`
  );
}

/**
 * Crypto payments auto-credit on confirmation, so they never generate a
 * "new top-up request" ping. This alert fires only when a payment ends up
 * flagged for a human (underpaid / overpaid / refunded). notify_role
 * dedupes within 5 minutes for the same title+link.
 */
export async function alertCryptoFlagged(input: {
  topupId: string;
  reason: string;
  tokens: number;
}): Promise<void> {
  await notifyRoles(
    "system",
    "Crypto payment needs review",
    `${input.reason} — ${input.tokens.toLocaleString()} tokens`,
    `/admin/topups?id=${input.topupId}`
  ).catch(() => undefined);
}

export async function alertNewDispute(input: {
  bookingId: string;
  openedBy: string;
  reason: string;
}): Promise<AdminAlertResult> {
  return notifyRoles(
    "dispute",
    "New dispute opened",
    `${input.openedBy} opened a dispute: ${truncate(input.reason, 120)}`,
    `/admin/disputes`
  );
}

export async function alertNewSellerApplication(input: {
  applicationId: string;
  displayName: string;
}): Promise<AdminAlertResult> {
  return notifyRoles(
    "system",
    "New seller application",
    `${input.displayName} applied to sell — pending review.`,
    `/admin/sellers`
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
