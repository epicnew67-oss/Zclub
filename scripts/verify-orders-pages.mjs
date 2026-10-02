/**
 * Verifies the order pages render for a real booking (regression: the
 * queries selected listings.slug, a column that doesn't exist, so every
 * order page 404'd / listed nothing).
 *
 *   node scripts/verify-orders-pages.mjs
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
  return `${name}=base64-${Buffer.from(JSON.stringify({ access_token: session.access_token, token_type: session.token_type, expires_in: session.expires_in, expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user }), "utf8").toString("base64url")}`;
}

async function makeUser(tag, role) {
  const email = `${tag}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: tag } });
  if (error) throw error;
  if (role) await admin.from("user_roles").insert({ user_id: data.user.id, role });
  const client = createClient(base, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
  if (loginErr) throw loginErr;
  const { data: s } = await client.auth.getSession();
  return { id: data.user.id, client, cookie: cookieFrom(s.session) };
}

const stamp = Date.now().toString(36);
const seller = await makeUser(`orders-seller-${stamp}`, "seller");
const { data: sellerProfile } = await admin
  .from("seller_profiles")
  .insert({ user_id: seller.id, slug: `orders-${stamp}`, display_name: `Orders ${stamp}` })
  .select("id")
  .single();
const { data: category } = await admin.from("categories").select("id").eq("is_active", true).limit(1).single();
const title = `Orders page check ${stamp}`;
const { data: listing } = await admin
  .from("listings")
  .insert({
    seller_id: sellerProfile.id, category_id: category.id, title,
    description: "Verifies the order pages render for a real booking.",
    price_tokens: 200, duration_minutes: 30, status: "approved", is_active: true,
  })
  .select("id")
  .single();
const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const { data: slot } = await admin
  .from("availability_slots")
  .insert({
    listing_id: listing.id, starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
    price_tokens: 200, status: "open",
  })
  .select("id")
  .single();

const buyer = await makeUser(`orders-buyer-${stamp}`, null);
const credit = await admin.rpc("wallet_credit", {
  _user_id: buyer.id, _amount: 1000, _entry_type: "support_adjustment",
  _ref_type: "test_fixture", _ref_id: randomUUID(), _description: "orders page check", _created_by: null,
});
if (credit.error) throw credit.error;

const purchase = await buyer.client.rpc("purchase_slot", { _slot_id: slot.id });
if (purchase.error) throw purchase.error;
const bookingId = purchase.data?.booking_id;
check("booking created", Boolean(bookingId), JSON.stringify(purchase.data));

const listHtml = await (await fetch(`${origin}/orders`, { headers: { cookie: buyer.cookie } })).text();
check("buyer /orders lists the booking", listHtml.includes(title));

const detailRes = await fetch(`${origin}/orders/${bookingId}`, { headers: { cookie: buyer.cookie } });
const detailHtml = await detailRes.text();
check("buyer order detail renders 200", detailRes.status === 200, `status=${detailRes.status}`);
check("buyer order detail shows the listing", detailHtml.includes(title));
check("buyer order detail is not the 404 page", !detailHtml.includes("<title>404"));

const sellerHtml = await (await fetch(`${origin}/seller/orders`, { headers: { cookie: seller.cookie } })).text();
check("seller /seller/orders lists the booking", sellerHtml.includes(title));

// ---------------------------------------------------------------- cleanup
try {
  await buyer.client.rpc("cancel_booking", { _booking_id: bookingId });
} catch {}
await admin.from("availability_slots").delete().eq("listing_id", listing.id);
await admin.from("listings").delete().eq("id", listing.id);
await admin.from("seller_profiles").delete().eq("id", sellerProfile.id);
await admin.auth.admin.deleteUser(seller.id);
await admin.auth.admin.deleteUser(buyer.id);

console.log(`\n${fails === 0 ? "ALL ORDER PAGE CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
