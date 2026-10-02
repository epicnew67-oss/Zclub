/**
 * Automated top-ups tests — `npm run test:topups`.
 *
 * Verifies, against the local Supabase stack + dev server:
 *   - Webhook HMAC verify (good sig 200, bad sig 401), finished-only
 *     crediting, idempotency, unknown payment ignored.
 *   - Underpaid -> needs_review and stays pending; overpaid -> credits
 *     pack only and flags; replay -> no double credit.
 *   - Manual manual approval (finance) credits exactly once, idempotent
 *     (replay -> already completed), rejects, expiry window, role gate,
 *     and that audit_log rows are written.
 *
 * Fixtures (wallet-test-topup-*@test.local, ledger rows) are left in the
 * local dev DB — users/ledger are never hard-deleted. `npx supabase db reset`
 * wipes local state.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
  );
}

const env = loadEnv();
const siteUrl = env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const origin = new URL(siteUrl).origin; // just for display
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const ipnSecret = env.NOWPAYMENTS_IPN_SECRET ?? "test-ipn-secret-change-me";

if (!base || !anonKey || !serviceKey) {
  console.error("Missing Supabase env in .env.local.");
  process.exit(1);
}

const admin = createClient(base, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS: ${name}`);
  else {
    failures += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- helpers

function sortedStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(value[k])}`).join(",")}}`;
}

function signIpn(payload, secret = ipnSecret) {
  return createHmac("sha512", secret).update(sortedStringify(payload)).digest("hex");
}

async function ensureDevServer() {
  try {
    const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5000) });
    if (response.status === 200) return null;
  } catch {}
  const child = spawn("C:\\WINDOWS\\System32\\cmd.exe", ["/c", "npm run dev"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  for (let i = 0; i < 50; i += 1) {
    await sleep(1200);
    try {
      const r = await fetch(`${origin}/`, { signal: AbortSignal.timeout(4000) });
      if (r.status === 200) return child.pid;
    } catch {}
  }
  throw new Error("Dev server did not become ready (needed for webhook POSTs).");
}

async function stopDevServer(pidOrNull) {
  if (!pidOrNull) return;
  spawnSync("C:\\WINDOWS\\System32\\cmd.exe", ["/c", "taskkill", "/pid", String(pidOrNull), "/T", "/F"], { stdio: "ignore" });
  await sleep(800);
}

// ---------------------------------------------------------------- fixtures

const packs = (
  await admin.from("token_packs").select("id, price_pkr, tokens").eq("is_active", true).order("sort_order")
).data;
if (!packs?.length) {
  console.error("No token packs seeded.");
  process.exit(1);
}
const pack = packs[1] ?? packs[0]; // 500 PKR -> 1000 tokens (above crypto_min_usd)

async function createTestUser(prefix = "wallet-test-topup") {
  const email = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: prefix },
  });
  if (error) throw error;
  const userId = data.user.id;
  const { data: wallet } = await admin.from("wallets").select("id").eq("user_id", userId).single();
  return { email, password, userId, walletId: wallet.id };
}

async function grantRole(userId, role) {
  const { error } = await admin.from("user_roles").insert({ user_id: userId, role });
  if (error && !String(error.message).includes("duplicate")) throw error;
}

let devPid = null;
try {
  devPid = await ensureDevServer();

  // ---------------------------------------------------------------- crypto: webhook 200 vs 401 + unknown

  const buyerCrypto = await createTestUser("topup-crypto");
  const walletCredit = async () => {
    const { data, error } = await admin.rpc("wallet_get_balance", { _user_id: buyerCrypto.userId });
    if (error) throw error;
    return data;
  };

  const cryptoPayId = `np-test-${randomUUID()}`;
  const { data: cryptoPayment, error: cryptoPayErr } = await admin
    .from("payments")
    .insert({
      user_id: buyerCrypto.userId,
      external_id: cryptoPayId,
      token_pack_id: pack.id,
      status: "pending",
      price_pkr: pack.price_pkr,
      tokens: pack.tokens,
      pay_currency: "usdt",
      pay_amount: 1.8,
      price_usd: 1.8,
      rate_lock: { usd_per_pkr: 0.0036, source: "test", locked_at: new Date().toISOString() },
      invoice_url: null,
    })
    .select("id")
    .single();
  if (cryptoPayErr) throw cryptoPayErr;

  await admin.from("topup_requests").insert({
    user_id: buyerCrypto.userId,
    payment_id: cryptoPayment.id,
    method: "crypto",
    token_pack_id: pack.id,
    tokens: pack.tokens,
    status: "pending",
  });

  // Bad signature must be 401.
  const badPayload = { payment_id: cryptoPayId, payment_status: "finished", pay_amount: 1.8, actually_paid: 1.8 };
  const badResponse = await fetch(`${origin}/api/webhooks/nowpayments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nowpayments-sig": "tampered" },
    body: JSON.stringify(badPayload),
  });
  check("webhook rejects bad signature (401)", badResponse.status === 401);

  // Good signature, finished -> credits exactly once, idempotent on replay.
  const payload = { payment_id: cryptoPayId, payment_status: "finished", pay_amount: 1.8, actually_paid: 1.8 };
  const sig = signIpn(payload);
  for (const attempt of [1, 2]) {
    const r = await fetch(`${origin}/api/webhooks/nowpayments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nowpayments-sig": sig },
      body: JSON.stringify(payload),
    });
    check(`webhook accepted (attempt ${attempt}, 200)`, r.status === 200, String(r.status));
  }
  check("sandbox crypto payment credited once (1000 tokens)", (await walletCredit()) === 1000);

  // Unknown payment is politely ignored (200).
  const unknownPayload = { payment_id: `np-unknown-${randomUUID()}`, payment_status: "finished", pay_amount: 1.8, actually_paid: 1.8 };
  const unknownResponse = await fetch(`${origin}/api/webhooks/nowpayments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nowpayments-sig": signIpn(unknownPayload),
    },
    body: JSON.stringify(unknownPayload),
  });
  check("unknown payment id -> 200 (ignored)", unknownResponse.status === 200);

  // Underpaid: finished but actually_paid well below expected -> flagged, not credited.
  const underPayId = `np-test-under-${randomUUID()}`;
  const { data: underPayment } = await admin
    .from("payments")
    .insert({
      user_id: buyerCrypto.userId,
      external_id: underPayId,
      token_pack_id: pack.id,
      status: "pending",
      price_pkr: pack.price_pkr,
      tokens: pack.tokens,
      pay_currency: "usdt",
      pay_amount: 1.8,
      invoice_url: null,
    })
    .select("id")
    .single();
  await admin.from("topup_requests").insert({
    user_id: buyerCrypto.userId,
    payment_id: underPayment.id,
    method: "crypto",
    token_pack_id: pack.id,
    tokens: pack.tokens,
    status: "pending",
  });
  const underPayload = { payment_id: underPayId, payment_status: "partially_paid", pay_amount: 1.8, actually_paid: 0.5 };
  const underResponse = await fetch(`${origin}/api/webhooks/nowpayments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nowpayments-sig": signIpn(underPayload),
    },
    body: JSON.stringify(underPayload),
  });
  check("underpaid partial payment flagged (200)", underResponse.status === 200);
  const { data: underRow } = await admin.from("payments").select("needs_review, status").eq("external_id", underPayId).single();
  check("underpaid payment needs_review = true", underRow?.needs_review === true);
  check("underpaid balance still 1000 (no extra credit)", (await walletCredit()) === 1000);

  // Overpaid: finished with actually_paid > pay_amount -> credits pack only + flags.
  const overPayId = `np-test-over-${randomUUID()}`;
  const { data: overPayment } = await admin
    .from("payments")
    .insert({
      user_id: buyerCrypto.userId,
      external_id: overPayId,
      token_pack_id: pack.id,
      status: "pending",
      price_pkr: pack.price_pkr,
      tokens: pack.tokens,
      pay_currency: "usdt",
      pay_amount: 1.8,
      invoice_url: null,
    })
    .select("id")
    .single();
  await admin.from("topup_requests").insert({
    user_id: buyerCrypto.userId,
    payment_id: overPayment.id,
    method: "crypto",
    token_pack_id: pack.id,
    tokens: pack.tokens,
    status: "pending",
  });
  const overPayload = { payment_id: overPayId, payment_status: "finished", pay_amount: 1.8, actually_paid: 10 };
  const overResponse = await fetch(`${origin}/api/webhooks/nowpayments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nowpayments-sig": signIpn(overPayload),
    },
    body: JSON.stringify(overPayload),
  });
  check("overpaid finished -> 200 and credits pack", overResponse.status === 200);
  check("overpaid balance is 2000 (credited 1000 pack only)", (await walletCredit()) === 2000);
  const { data: overRow } = await admin.from("payments").select("needs_review, flag_reason").eq("external_id", overPayId).single();
  check("overpaid payment flagged", overRow?.needs_review === true && /overpaid/.test(overRow?.flag_reason ?? ""));

  // ---------------------------------------------------------------- manual: finance approval each credits exactly once

  const buyerManual = await createTestUser("topup-manual");
  const finance = await createTestUser("topup-finance");
  await grantRole(finance.userId, "finance");

  const buyerManualBalance = async () => {
    const { data } = await admin.rpc("wallet_get_balance", { _user_id: buyerManual.userId });
    return data;
  };

  const manualRef = `SC-${randomUUID().slice(0, 6).toUpperCase()}`;
  const { data: manualTopup, error: manualErr } = await admin
    .from("topup_requests")
    .insert({
      user_id: buyerManual.userId,
      method: "jazzcash",
      token_pack_id: pack.id,
      tokens: pack.tokens,
      status: "pending",
      reference_code: manualRef,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (manualErr) throw manualErr;

  const txId = `TESTTX-${randomUUID().slice(0, 8).toUpperCase()}`;
  await admin.from("topup_requests").update({
    transaction_id: txId,
    sender_number: "03001234567",
  }).eq("id", manualTopup.id);

  // Buyer self must not be able to approve (insufficient_privilege).
  const buyerClient = createClient(base, anonKey, { auth: { persistSession: false } });
  await buyerClient.auth.signInWithPassword({ email: buyerManual.email, password: buyerManual.password });
  const { error: buyerApproveError } = await buyerClient.rpc("finance_approve_topup", { _topup_id: manualTopup.id });
  check("non-finance buyer cannot approve (insufficient_privilege)", Boolean(buyerApproveError));

  const financeClient = createClient(base, anonKey, { auth: { persistSession: false } });
  await financeClient.auth.signInWithPassword({ email: finance.email, password: finance.password });

  const { error: approveError } = await financeClient.rpc("finance_approve_topup", {
    _topup_id: manualTopup.id,
    _note: "looks legit",
  });
  check("finance approves manual top-up", !approveError, approveError?.message);
  check("manual top-up credited once (1000 tokens)", (await buyerManualBalance()) === 1000);

  const { error: reApproveError } = await financeClient.rpc("finance_approve_topup", {
    _topup_id: manualTopup.id,
  });
  check("re-approving is blocked (already completed)", Boolean(reApproveError));
  check("balance still 1000 after re-approve attempt", (await buyerManualBalance()) === 1000);

  const { count: auditApproved } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "topup.approve")
    .eq("target_id", manualTopup.id);
  check("audit_log has one topup.approve row", auditApproved === 1);

  // Reject path — second manual top-up
  const { data: manualReject } = await admin
    .from("topup_requests")
    .insert({
      user_id: buyerManual.userId,
      method: "easypaisa",
      token_pack_id: pack.id,
      tokens: pack.tokens,
      status: "pending",
      reference_code: `SC-${randomUUID().slice(0, 6).toUpperCase()}`,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      transaction_id: `TESTTX-${randomUUID().slice(0, 8).toUpperCase()}`,
      sender_number: "03009876543",
    })
    .select("id")
    .single();

  const { error: rejectError } = await financeClient.rpc("finance_reject_topup", {
    _topup_id: manualReject.id,
    _reason: "fake screenshot",
  });
  check("finance rejects with a reason", !rejectError, rejectError?.message);
  const { data: rejectedRow } = await admin.from("topup_requests").select("status, review_note").eq("id", manualReject.id).single();
  check("rejected top-up status is failed", rejectedRow?.status === "failed");
  check("reject left balance at 1000 (no credit)", (await buyerManualBalance()) === 1000);
  const { count: auditRejected } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "topup.reject")
    .eq("target_id", manualReject.id);
  check("audit_log has one topup.reject row", auditRejected === 1);

  // Expiry window: expired pending manual request -> approve refused.
  const { data: expiring } = await admin
    .from("topup_requests")
    .insert({
      user_id: buyerManual.userId,
      method: "jazzcash",
      token_pack_id: pack.id,
      tokens: pack.tokens,
      status: "pending",
      reference_code: `SC-${randomUUID().slice(0, 6).toUpperCase()}`,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      transaction_id: `TESTTX-${randomUUID().slice(0, 8).toUpperCase()}`,
      sender_number: "03001234567",
    })
    .select("id")
    .single();
  const { error: expiryError } = await financeClient.rpc("finance_approve_topup", {
    _topup_id: expiring.id,
  });
  check("expired manual top-up cannot be approved", Boolean(expiryError));

  console.log(`\nCrypto buyer (${buyerCrypto.email}) finance (${finance.email}) manual buyer (${buyerManual.email}) left in dev DB.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  failures += 1;
} finally {
  await stopDevServer(devPid);
  if (failures > 0) {
    console.error(`\n${failures} top-up test(s) FAILED`);
    process.exit(1);
  }
  console.log("All top-up tests passed.");
}
