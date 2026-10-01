/**
 * Verifies the in-app crypto checkout end-to-end against the LOCAL stack:
 *
 *   A. Direct payment panel — a crypto top-up with a deposit address
 *      renders the full payment UI (coin, exact amount, address, QR,
 *      copy buttons, REAL status copy: "Waiting for payment", not a
 *      blanket "confirming").
 *   B. Direct payment IPN — signed webhook keyed by payment_id credits
 *      exactly once, marks the top-up completed, and mirrors the status
 *      into payments.pay_status; replays are no-ops.
 *   C. Legacy invoice IPN — signed webhook keyed by invoice_id still
 *      resolves and credits (backwards compatibility).
 *
 *   node scripts/verify-crypto-flow.mjs
 */
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const origin = "http://localhost:3000";
const admin = createClient(base, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const authClient = createClient(base, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

function sortedStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(value[k])}`).join(",")}}`;
}

const sign = (body) =>
  createHmac("sha512", env.NOWPAYMENTS_IPN_SECRET).update(sortedStringify(body)).digest("hex");

const postIpn = (body) =>
  fetch(`${origin}/api/webhooks/nowpayments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nowpayments-signature": sign(body), "x-nowpayments-sig": sign(body) },
    body: JSON.stringify(body),
  }).then((r) => r.json());

async function makeBuyer(tag) {
  const email = `${tag}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: tag },
  });
  if (error) throw error;
  const { data: login, error: loginErr } = await authClient.auth.signInWithPassword({ email, password });
  if (loginErr) throw loginErr;
  const cookieName = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;
  const cookie = `${cookieName}=base64-${Buffer.from(
    JSON.stringify({
      access_token: login.session.access_token,
      token_type: login.session.token_type,
      expires_in: login.session.expires_in,
      expires_at: login.session.expires_at,
      refresh_token: login.session.refresh_token,
      user: login.session.user,
    }),
    "utf8"
  ).toString("base64url")}`;
  return { userId: data.user.id, cookie };
}

const { data: packs } = await admin
  .from("token_packs")
  .select("id, label, price_pkr, tokens")
  .eq("is_active", true)
  .order("price_pkr", { ascending: true })
  .limit(1);
const pack = packs?.[0];
if (!pack) throw new Error("no active token pack — run db reset");

// ---------------------------------------------------------------- A + B
const buyer = await makeBuyer("crypto-direct");
const paymentId = `np-direct-${Date.now().toString(36)}`;
const payAddress = "M8PSV1t2vVamz6nKFVG2YnNnuknkXBJJE8";
const { data: payment, error: payErr } = await admin
  .from("payments")
  .insert({
    user_id: buyer.userId,
    external_id: paymentId,
    token_pack_id: pack.id,
    status: "pending",
    price_pkr: pack.price_pkr,
    tokens: pack.tokens,
    price_usd: 18,
    pay_currency: "ltc",
    pay_amount: 0.29839161,
    pay_address: payAddress,
    pay_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    pay_status: "waiting",
  })
  .select("id")
  .single();
if (payErr) throw payErr;

const { data: topup, error: topupErr } = await admin
  .from("topup_requests")
  .insert({
    user_id: buyer.userId,
    payment_id: payment.id,
    method: "crypto",
    token_pack_id: pack.id,
    tokens: pack.tokens,
    status: "pending",
  })
  .select("id")
  .single();
if (topupErr) throw topupErr;

const statusRes = await fetch(`${origin}/wallet/topup/status?id=${topup.id}&return=%2Fwallet`, {
  headers: { cookie: buyer.cookie },
});
const html = await statusRes.text();
check("A: status page renders 200", statusRes.status === 200, `status=${statusRes.status}`);
check("A: not 'Top-up not found'", !html.includes("Top-up not found"));
check("A: shows 'Pay with' block", html.includes("Pay with") && html.includes("LTC"));
check("A: shows waiting status (not blanket 'confirming')", html.includes("Waiting for payment"));
check("A: shows exact amount", html.includes("0.29839161"));
check("A: shows deposit address", html.includes(payAddress));
check("A: QR code present", html.includes("Payment QR code"));
check("A: copy address button", html.includes("Copy address"));
check("A: copy amount button", html.includes("Copy amount"));

const directPayload = {
  payment_id: paymentId,
  payment_status: "finished",
  pay_amount: 0.29839161,
  actually_paid: 0.29839161,
  actually_paid_at_fiat: 18,
  pay_currency: "ltc",
};
const first = await postIpn(directPayload);
check("B: direct IPN (payment_id) accepted", first?.credited === true, JSON.stringify(first));
const second = await postIpn(directPayload);
check("B: replay is a no-op", second?.reason === "already_completed", JSON.stringify(second));

const { data: balance } = await authClient.rpc("get_own_wallet_balance");
check(`B: credited exactly once (${pack.tokens} tokens)`, Number(balance) === pack.tokens, `balance=${balance}`);

const { data: after } = await admin
  .from("topup_requests")
  .select("status, payments(pay_status)")
  .eq("id", topup.id)
  .single();
check("B: topup completed", after?.status === "completed", `status=${after?.status}`);
check(
  "B: payments.pay_status mirrored from IPN",
  after?.payments?.pay_status === "finished",
  `pay_status=${after?.payments?.pay_status}`
);

// ---------------------------------------------------------------- C
const legacyBuyer = await makeBuyer("crypto-invoice");
const invoiceId = `inv-legacy-${Date.now().toString(36)}`;
const { data: legacyPayment, error: legacyPayErr } = await admin
  .from("payments")
  .insert({
    user_id: legacyBuyer.userId,
    external_id: invoiceId,
    token_pack_id: pack.id,
    status: "pending",
    price_pkr: pack.price_pkr,
    tokens: pack.tokens,
    price_usd: 18,
    invoice_url: `https://nowpayments.io/payment/?iid=${invoiceId}`,
  })
  .select("id")
  .single();
if (legacyPayErr) throw legacyPayErr;
const { data: legacyTopup, error: legacyTopupErr } = await admin
  .from("topup_requests")
  .insert({
    user_id: legacyBuyer.userId,
    payment_id: legacyPayment.id,
    method: "crypto",
    token_pack_id: pack.id,
    tokens: pack.tokens,
    status: "pending",
  })
  .select("id")
  .single();
if (legacyTopupErr) throw legacyTopupErr;

const legacyIpn = await postIpn({
  payment_id: Math.floor(Math.random() * 1e9),
  invoice_id: invoiceId,
  payment_status: "finished",
  actually_paid: 17.9,
  actually_paid_at_fiat: 17.9,
  pay_currency: "trx",
});
check("C: legacy invoice IPN still credits", legacyIpn?.credited === true, JSON.stringify(legacyIpn));

console.log(`\n${fails === 0 ? "ALL CRYPTO FLOW CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
