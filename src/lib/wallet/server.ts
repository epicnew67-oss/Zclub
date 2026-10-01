/**
 * Server-side wallet helpers.
 *
 * Thin typed wrappers around the `wallet_credit`, `wallet_debit`, and
 * `wallet_get_balance` RPCs in the database. Every money change in
 * the system goes through one of these — the RPCs run inside a single
 * transaction with the wallet row locked, enforce idempotency by
 * (ref_type, ref_id), and refuse to overdraw.
 *
 * Never call these from the browser. They require the service-role
 * key and only the service_role role is GRANTed on the functions.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type LedgerEntryType =
  | "topup"
  | "booking_hold"
  | "booking_release"
  | "booking_refund"
  | "payout"
  | "support_adjustment"
  | "bonus";

export type LedgerRefType = "payment" | "booking" | "payout" | "support" | "dev";

export type LedgerEntry = {
  id: number;
  wallet_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  ref_type: string | null;
  ref_id: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
};

type CreditArgs = {
  userId: string;
  amount: number;
  entryType: LedgerEntryType;
  refType: LedgerRefType;
  refId: string;
  description?: string | null;
  createdBy?: string | null;
};

/**
 * Add tokens to a wallet. Idempotent: replaying the same
 * (refType, refId) returns the original entry without inserting a
 * second row.
 */
export async function credit(args: CreditArgs): Promise<LedgerEntry> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("wallet_credit", {
    _user_id: args.userId,
    _amount: args.amount,
    _entry_type: args.entryType,
    _ref_type: args.refType,
    _ref_id: args.refId,
    _description: args.description ?? null,
    _created_by: args.createdBy ?? null,
  });
  if (error) throw error;
  return data as LedgerEntry;
}

type DebitArgs = {
  userId: string;
  amount: number;
  entryType: LedgerEntryType;
  refType: LedgerRefType;
  refId: string;
  description?: string | null;
  createdBy?: string | null;
};

/**
 * Remove tokens from a wallet. Locks the wallet row, refuses if the
 * balance would go negative, and is idempotent by (refType, refId).
 */
export async function debit(args: DebitArgs): Promise<LedgerEntry> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("wallet_debit", {
    _user_id: args.userId,
    _amount: args.amount,
    _entry_type: args.entryType,
    _ref_type: args.refType,
    _ref_id: args.refId,
    _description: args.description ?? null,
    _created_by: args.createdBy ?? null,
  });
  if (error) throw error;
  return data as LedgerEntry;
}

/**
 * Sum of all ledger entries for a user. Never reads a stored balance.
 */
export async function getBalance(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("wallet_get_balance", {
    _user_id: userId,
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}