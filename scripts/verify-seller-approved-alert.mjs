/**
 * Verifies the "seller onboarding accepted" popup:
 *   - an approved application pops the alert on /seller and /account
 *   - a pending application does not
 *
 *   node scripts/verify-seller-approved-alert.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

function cookieFrom(session) {
  const name = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;
  return `${name}=base64-${Buffer.from(
    JSON.stringify({
      access_token: session.access_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      refresh_token: session.refresh_token,
      user: session.user,
    }),
    "utf8"
  ).toString("base64url")}`;
}

async function makeUser(tag, role) {
  const email = `${tag}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: tag },
  });
  if (error) throw error;
  if (role) await admin.from("user_roles").insert({ user_id: data.user.id, role });
  const client = createClient(base, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
  if (loginErr) throw loginErr;
  const { data: s } = await client.auth.getSession();
  return { id: data.user.id, cookie: cookieFrom(s.session) };
}

const ALERT_COPY = "Your seller onboarding was accepted";

// ---------------------------------------------------------------- approved
const approved = await makeUser("alert-approved", "seller");
const { data: approvedApp, error: approvedAppErr } = await admin
  .from("seller_applications")
  .insert({
    user_id: approved.id,
    status: "approved",
    display_name: `Alert Approved ${Date.now().toString(36)}`,
    motivation: "Verify the accepted-onboarding alert pops for new sellers.",
    reviewed_at: new Date().toISOString(),
  })
  .select("id")
  .single();
if (approvedAppErr) throw approvedAppErr;

const sellerPage = await fetch(`${origin}/seller`, { headers: { cookie: approved.cookie } });
const sellerHtml = await sellerPage.text();
check("approved: /seller renders 200", sellerPage.status === 200, `status=${sellerPage.status}`);
check("approved: alert pops on /seller", sellerHtml.includes(ALERT_COPY));
check("approved: alert has the Open action", sellerHtml.includes("/seller/listings/new"));

const accountPage = await fetch(`${origin}/account`, { headers: { cookie: approved.cookie } });
const accountHtml = await accountPage.text();
check("approved: alert pops on /account", accountHtml.includes(ALERT_COPY));

// ---------------------------------------------------------------- pending
const pending = await makeUser("alert-pending", null);
const { data: pendingApp, error: pendingAppErr } = await admin
  .from("seller_applications")
  .insert({
    user_id: pending.id,
    status: "pending",
    display_name: `Alert Pending ${Date.now().toString(36)}`,
    motivation: "Verify pending applications do not pop the alert.",
  })
  .select("id")
  .single();
if (pendingAppErr) throw pendingAppErr;

const pendingAccount = await fetch(`${origin}/account`, { headers: { cookie: pending.cookie } });
const pendingHtml = await pendingAccount.text();
check("pending: no alert on /account", !pendingHtml.includes(ALERT_COPY));

// ---------------------------------------------------------------- cleanup
await admin.from("seller_applications").delete().in("id", [approvedApp.id, pendingApp.id]);
await admin.auth.admin.deleteUser(approved.id);
await admin.auth.admin.deleteUser(pending.id);

console.log(`\n${fails === 0 ? "ALL SELLER APPROVED-ALERT CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);

