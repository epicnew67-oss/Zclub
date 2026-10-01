/**
 * Verifies the crypto invoice flow end-to-end against the LOCAL stack:
 *
 *   1. creates a buyer + a synthetic invoice top-up (external_id = invoice
 *      id, no pay_address — the column doesn't exist)
 *   2. the wallet status page renders the invoice link (regression: a bogus
 *      `pay_address` in the select made every status view say
 *      "Top-up not found")
 *   3. an IPN carrying `invoice_id` finds the payment row and credits once
 *   4. a replayed IPN is a no-op
 *
 *   node scripts/verify-crypto-invoice-flow.mjs
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

// ---------------------------------------------------------------- fixtures
const email = `invoice-flow-${Date.now().toString(36)}@test.local`;
const password = `Pw-${randomUUID()}`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: "Invoice Flow" },
});
if (createErr) throw createErr;
const userId = created.user.id;

const { data: packs } = await admin
  .from("token_packs")
  .select("id, label, price_pkr, tokens")
  .eq("is_active", true)
  .order("price_pkr", { ascending: false })
  .limit(1);
const pack = packs?.[0];
if (!pack) throw new Error("no active token pack — run db reset");

const invoiceId = `inv-verify-${Date.now().toString(36)}`;
const { data: payment, error: payErr } = await admin
  .from("payments")
  .insert({
    user_id: userId,
    external_id: invoiceId,
    token_pack_id: pack.id,
    status: "pending",
    price_pkr: pack.price_pkr,
    tokens: pack.tokens,
    price_usd: 18,
    pay_currency: null,
    pay_amount: null,
    invoice_url: `https://nowpayments.io/payment/?iid=${invoiceId}`,
  })
  .select("id")
  .single();
if (payErr) throw payErr;

const { data: topup, error: topupErr } = await admin
  .from("topup_requests")
  .insert({
    user_id: userId,
    payment_id: payment.id,
    method: "crypto",
    token_pack_id: pack.id,
    tokens: pack.tokens,
    status: "pending",
  })
  .select("id")
  .single();
if (topupErr) throw topupErr;

// ---------------------------------------------------------------- session
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

// ---------------------------------------------------------------- status page
const statusRes = await fetch(
  `${origin}/wallet/topup/status?id=${topup.id}&return=%2Fwallet`,
  { headers: { cookie } }
);
const statusHtml = await statusRes.text();
check("status page renders 200", statusRes.status === 200, `status=${statusRes.status}`);
check("status page is not 'Top-up not found'", !statusHtml.includes("Top-up not found"));
check("status page shows the invoice link", statusHtml.includes("Open invoice"));
check("status page shows pending copy", statusHtml.includes("Payment confirming"));
check("status page embeds the invoice url", statusHtml.includes(invoiceId));

// ---------------------------------------------------------------- IPN (invoice_id)
const payload = {
  payment_id: Math.floor(Math.random() * 1e9),
  invoice_id: Number(invoiceId.replace(/\D/g, "").slice(0, 9)) || 123456789,
  payment_status: "finished",
  price_amount: 18,
  price_currency: "usd",
  pay_amount: 17.9,
  actually_paid: 17.9,
  pay_currency: "ltc",
  order_id: `pack-${pack.id}-verify`,
};
// Match the webhook's lookup: invoice_id is what external_id stores.
payload.invoice_id = invoiceId;

const sign = (body) =>
  createHmac("sha512", env.NOWPAYMENTS_IPN_SECRET).update(sortedStringify(body)).digest("hex");

const postIpn = (body) =>
  fetch(`${origin}/api/webhooks/nowpayments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nowpayments-sig": sign(body) },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const first = await postIpn(payload);
check("IPN with invoice_id is accepted", first?.credited === true, JSON.stringify(first));

const second = await postIpn(payload);
check("replayed IPN is a no-op", second?.reason === "already_completed", JSON.stringify(second));

const { data: balance } = await authClient.rpc("get_own_wallet_balance");
check(
  `wallet credited exactly once (${pack.tokens} tokens)`,
  Number(balance) === pack.tokens,
  `balance=${balance}`
);

const { data: finalTopup } = await admin
  .from("topup_requests")
  .select("status")
  .eq("id", topup.id)
  .single();
check("topup row completed", finalTopup?.status === "completed", `status=${finalTopup?.status}`);

console.log(`\n${fails === 0 ? "ALL CRYPTO INVOICE FLOW CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
