/**
 * Verifies the listing buy panel matches the real session (fresh reload):
 *   - guest sees "Sign in to book"
 *   - signed-in user sees the buy flow ("Pick a slot first" / "Reserve
 *     this slot"), never the signed-out CTA
 *
 *   node scripts/verify-listing-buy-panel.mjs
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

function titleSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const stamp = Date.now().toString(36);
const sellerSlug = `buy-panel-${stamp}`;

// seller
const email = `buy-panel-seller-${stamp}@test.local`;
const password = `Pw-${randomUUID()}`;
const { data: sellerUser, error: sellerErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { display_name: `buy-panel-display-${stamp}` },
});
if (sellerErr) throw sellerErr;
await admin.from("user_roles").insert({ user_id: sellerUser.user.id, role: "seller" });
const { data: sellerProfile, error: profileErr } = await admin
  .from("seller_profiles")
  .insert({ user_id: sellerUser.user.id, slug: sellerSlug, display_name: `buy-panel-display-${stamp}` })
  .select("id")
  .single();
if (profileErr) throw profileErr;

const { data: category } = await admin.from("categories").select("id").eq("is_active", true).limit(1).single();
const title = `Buy panel check ${stamp}`;
const { data: listing, error: listingErr } = await admin
  .from("listings")
  .insert({
    seller_id: sellerProfile.id,
    category_id: category.id,
    title,
    description: "Verifies the buy panel session handling.",
    price_tokens: 100,
    duration_minutes: 15,
    status: "approved",
    is_active: true,
  })
  .select("id")
  .single();
if (listingErr) throw listingErr;

const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
const { data: slot, error: slotErr } = await admin
  .from("availability_slots")
  .insert({
    listing_id: listing.id,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + 15 * 60 * 1000).toISOString(),
    price_tokens: 100,
    status: "open",
  })
  .select("id")
  .single();
if (slotErr) throw slotErr;

const slug = `${sellerSlug}--${titleSlug(title)}`;

// guest
const guestHtml = await (await fetch(`${origin}/listings/${slug}`)).text();
check("guest: page renders", guestHtml.includes(title));
check("guest: sees 'Sign in to book'", guestHtml.includes("Sign in to book"));
check("guest: no reserve button", !guestHtml.includes("Reserve this slot"));

// signed-in buyer
const buyerEmail = `buy-panel-buyer-${stamp}@test.local`;
const buyerPassword = `Pw-${randomUUID()}`;
const { data: buyer, error: buyerErr } = await admin.auth.admin.createUser({
  email: buyerEmail, password: buyerPassword, email_confirm: true, user_metadata: { display_name: "buyer" },
});
if (buyerErr) throw buyerErr;
const authClient = createClient(base, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: login, error: loginErr } = await authClient.auth.signInWithPassword({ email: buyerEmail, password: buyerPassword });
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

const signedHtml = await (await fetch(`${origin}/listings/${slug}`, { headers: { cookie } })).text();
check("signed-in: NO 'Sign in to book'", !signedHtml.includes("Sign in to book"));
check("signed-in: sees 'Pick a slot first'", signedHtml.includes("Pick a slot first"));

const slotHtml = await (
  await fetch(`${origin}/listings/${slug}?slot=${slot.id}`, { headers: { cookie } })
).text();
check("signed-in with slot: sees 'Reserve this slot'", slotHtml.includes("Reserve this slot"));
check("signed-in with slot: still no sign-in CTA", !slotHtml.includes("Sign in to book"));

// cleanup
await admin.from("availability_slots").delete().eq("listing_id", listing.id);
await admin.from("listings").delete().eq("id", listing.id);
await admin.from("seller_profiles").delete().eq("id", sellerProfile.id);
await admin.auth.admin.deleteUser(sellerUser.user.id);
await admin.auth.admin.deleteUser(buyer.user.id);

console.log(`\n${fails === 0 ? "ALL BUY-PANEL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
