/**
 * Verifies the call grace window: a booking whose slot ended minutes ago
 * can still start the call; one past the grace cannot.
 *
 *   node scripts/verify-call-grace.mjs local
 *   node scripts/verify-call-grace.mjs live
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2] === "live" ? "live" : "local";
const envFile = mode === "live" ? ".env.production.local" : ".env.local";
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const site = mode === "live" ? "https://zclub-lime.vercel.app" : "http://localhost:3000";
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
const seller = await makeUser(`grace-seller-${stamp}`, "seller");
const buyer = await makeUser(`grace-buyer-${stamp}`, null);
const { data: sellerProfile } = await admin
  .from("seller_profiles")
  .insert({ user_id: seller.id, slug: `grace-${stamp}`, display_name: `Grace ${stamp}` })
  .select("id")
  .single();
const { data: category } = await admin.from("categories").select("id").eq("is_active", true).limit(1).single();
const title = `Grace window check ${stamp}`;
const { data: listing } = await admin
  .from("listings")
  .insert({
    seller_id: sellerProfile.id, category_id: category.id, title,
    description: "Verifies the call grace window.", price_tokens: 100,
    duration_minutes: 30, status: "approved", is_active: true,
  })
  .select("id")
  .single();

async function makeBooking(endedMinutesAgo) {
  const end = new Date(Date.now() - endedMinutesAgo * 60_000);
  const start = new Date(end.getTime() - 30 * 60_000);
  const { data: slot } = await admin
    .from("availability_slots")
    .insert({
      listing_id: listing.id, starts_at: start.toISOString(),
      ends_at: end.toISOString(), price_tokens: 100, status: "booked",
    })
    .select("id")
    .single();
  const { data: booking } = await admin
    .from("bookings")
    .insert({
      buyer_id: buyer.id, seller_id: seller.id, listing_id: listing.id,
      slot_id: slot.id, price_tokens: 100, status: "paid",
    })
    .select("id")
    .single();
  await admin.from("booking_chats").insert({ booking_id: booking.id });
  return booking.id;
}

const withinGrace = await makeBooking(10); // ended 10 min ago
const pastGrace = await makeBooking(120); // ended 2 h ago

const mintA = await buyer.client.rpc("mint_livekit_token", { _booking_id: withinGrace });
check(`${mode}: within grace → token minted`, mintA.data?.ok === true, JSON.stringify(mintA.data ?? mintA.error));

const mintB = await buyer.client.rpc("mint_livekit_token", { _booking_id: pastGrace });
check(`${mode}: past grace → too_late`, mintB.data?.code === "too_late", JSON.stringify(mintB.data ?? mintB.error));

const pageA = await (await fetch(`${site}/orders/${withinGrace}`, { headers: { cookie: buyer.cookie } })).text();
check(`${mode}: join button enabled within grace`, pageA.includes('data-join-call="ready"'));

const pageB = await (await fetch(`${site}/orders/${pastGrace}`, { headers: { cookie: buyer.cookie } })).text();
check(`${mode}: join button disabled past grace`, pageB.includes('data-join-call="disabled"'));
check(`${mode}: past grace shows 'Call ended'`, pageB.includes("Call ended"));

// ---------------------------------------------------------------- cleanup
await admin.from("booking_chats").delete().in("booking_id", [withinGrace, pastGrace]);
await admin.from("bookings").delete().in("id", [withinGrace, pastGrace]);
await admin.from("availability_slots").delete().eq("listing_id", listing.id);
await admin.from("listings").delete().eq("id", listing.id);
await admin.from("seller_profiles").delete().eq("id", sellerProfile.id);
await admin.auth.admin.deleteUser(seller.id);
await admin.auth.admin.deleteUser(buyer.id);

console.log(`\n${fails === 0 ? `ALL CALL GRACE CHECKS PASSED (${mode})` : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
