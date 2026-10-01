/**
 * Automated wallet tests — `npm test` (or `npm run test:wallet`).
 *
 * Covers the three required guarantees:
 *   1. Double-credit prevented (idempotent by ref_id — same ref applies once).
 *   2. Concurrent debits cannot overdraw (wallet row lock + balance check).
 *   3. Ledger sum equals balance (no stored balance anywhere).
 *
 * Runs against the local Supabase stack using .env.local. Requires
 * `npx supabase start` (wallet migration applied) and the service-role key.
 *
 * Note: users and ledger rows are never hard-deleted, so the throwaway
 * `wallet-test-*@test.local` fixture user + its ledger rows intentionally
 * stay in the local dev DB. `npx supabase db reset` wipes local state.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------- env

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(
      (line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")
    )
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    "Missing Supabase env values in .env.local (URL, anon key, service role key)."
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS: ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- fixture

const email = `wallet-test-${Date.now().toString(36)}@test.local`;
const password = `pw-${crypto.randomUUID()}`;

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: "Wallet Test" },
});
if (createError) {
  console.error(`Could not create test user: ${createError.message}`);
  process.exit(1);
}
const userId = created.user.id;

const { data: walletRow, error: walletError } = await admin
  .from("wallets")
  .select("id")
  .eq("user_id", userId)
  .single();
if (walletError) {
  console.error(`Signup trigger did not provision a wallet: ${walletError.message}`);
  process.exit(1);
}
const walletId = walletRow.id;

// A real user session, to test the user-facing balance RPC too.
const userClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: signInError } = await userClient.auth.signInWithPassword({
  email,
  password,
});
if (signInError) {
  console.error(`Test user sign-in failed: ${signInError.message}`);
  process.exit(1);
}

const serverBalance = async () => {
  const { data, error } = await admin.rpc("wallet_get_balance", {
    _user_id: userId,
  });
  if (error) throw new Error(error.message);
  return data;
};

const userBalance = async () => {
  const { data, error } = await userClient.rpc("get_own_wallet_balance");
  if (error) throw new Error(error.message);
  return data;
};

const ledgerSum = async () => {
  const { data, error } = await admin
    .from("ledger_entries")
    .select("amount")
    .eq("wallet_id", walletId);
  if (error) throw new Error(error.message);
  return data.reduce((sum, row) => sum + row.amount, 0);
};

// ------------------------------------------- 1. double-credit prevented

const creditRef = crypto.randomUUID();
const creditArgs = {
  _user_id: userId,
  _amount: 1000,
  _entry_type: "bonus",
  _ref_type: "test",
  _ref_id: creditRef,
  _description: "wallet test credit",
};

const first = await admin.rpc("wallet_credit", creditArgs);
check("credit applies", !first.error, first.error?.message);

const replay = await admin.rpc("wallet_credit", creditArgs);
check(
  "replaying the same ref_id returns the original entry (not a new one)",
  !replay.error && replay.data.id === first.data.id,
  replay.error?.message ?? `ids ${first.data?.id} vs ${replay.data?.id}`
);

const { count: refCount } = await admin
  .from("ledger_entries")
  .select("id", { count: "exact", head: true })
  .eq("wallet_id", walletId)
  .eq("ref_id", creditRef);
check(
  "same ref_id inserted exactly one ledger row",
  refCount === 1,
  `count=${refCount}`
);

const afterDoubleCredit = await serverBalance();
check(
  "balance is 1000 after a double-credit attempt (not 2000)",
  afterDoubleCredit === 1000,
  `balance=${afterDoubleCredit}`
);

// ------------------------------------- 2. concurrent debits can't overdraw

const debit = (amount) =>
  admin.rpc("wallet_debit", {
    _user_id: userId,
    _amount: amount,
    _entry_type: "payout",
    _ref_type: "test",
    _ref_id: crypto.randomUUID(),
    _description: "wallet test concurrent debit",
  });

// Two 600-token debits fire at the same time against a 1000 balance.
// The wallet row lock serializes them; only one can win.
const results = await Promise.all([debit(600), debit(600)]);
const succeeded = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);

check(
  "exactly one of two concurrent debits succeeds",
  succeeded.length === 1 && failed.length === 1,
  `succeeded=${succeeded.length} failed=${failed.length}`
);
check(
  "the losing debit fails with insufficient balance",
  /insufficient balance/.test(failed[0]?.error?.message ?? ""),
  failed[0]?.error?.message
);

const afterDebits = await serverBalance();
check(
  "balance never went negative (1000 - 600 = 400)",
  afterDebits === 400,
  `balance=${afterDebits}`
);

// --------------------------------------- 3. ledger sum equals balance

const sum = await ledgerSum();
check(
  "ledger sum == wallet_get_balance (server)",
  sum === afterDebits,
  `sum=${sum} balance=${afterDebits}`
);

const seenByUser = await userBalance();
check(
  "ledger sum == get_own_wallet_balance (the user's own view)",
  sum === 400 && seenByUser === 400,
  `sum=${sum} userBalance=${seenByUser}`
);

// ---------------------------------------------------------------- done

console.log(`\nTest user (left in local dev DB): ${email}`);
if (failures > 0) {
  console.error(`\n${failures} wallet test(s) FAILED`);
  process.exit(1);
}
console.log("All wallet tests passed.");
