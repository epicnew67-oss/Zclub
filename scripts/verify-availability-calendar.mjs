/**
 * Verifies the availability calendar (watermelon calendar-widget):
 *   - the widget renders on /seller/availability
 *   - AM/PM controls + a forced-hour12 "Local time" preview are present
 *   - the seller's slots appear as calendar event dots
 *   - removing a slot makes the event disappear on the next render
 *
 *   node scripts/verify-availability-calendar.mjs local
 *   node scripts/verify-availability-calendar.mjs live
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

const stamp = Date.now().toString(36);
const email = `avail-cal-${stamp}@test.local`;
const password = `Pw-${randomUUID()}`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { display_name: `avail-cal ${stamp}` },
});
if (createErr) throw createErr;
await admin.from("user_roles").insert({ user_id: created.user.id, role: "seller" });
const { data: profile, error: profileErr } = await admin
  .from("seller_profiles")
  .insert({ user_id: created.user.id, slug: `avail-cal-${stamp}`, display_name: `Avail Cal ${stamp}` })
  .select("id")
  .single();
if (profileErr) throw profileErr;
const { data: category } = await admin.from("categories").select("id").eq("is_active", true).limit(1).single();
const { data: listing, error: listingErr } = await admin
  .from("listings")
  .insert({
    seller_id: profile.id, category_id: category.id, title: `Avail cal ${stamp}`,
    description: "Verifies the availability calendar widget.",
    price_tokens: 100, duration_minutes: 15, status: "approved", is_active: true,
  })
  .select("id")
  .single();
if (listingErr) throw listingErr;

const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const { data: slot, error: slotErr } = await admin
  .from("availability_slots")
  .insert({
    listing_id: listing.id, starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + 15 * 60 * 1000).toISOString(),
    price_tokens: 100, status: "open",
  })
  .select("id")
  .single();
if (slotErr) throw slotErr;

const client = createClient(base, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
if (loginErr) throw loginErr;
const { data: s } = await client.auth.getSession();
const cookieName = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;
const cookie = `${cookieName}=base64-${Buffer.from(JSON.stringify({ access_token: s.session.access_token, token_type: s.session.token_type, expires_in: s.session.expires_in, expires_at: s.session.expires_at, refresh_token: s.session.refresh_token, user: s.session.user }), "utf8").toString("base64url")}`;

// Retry while a live deploy rolls out.
let html = "";
let ready = false;
for (let i = 0; i < 12; i += 1) {
  const res = await fetch(`${site}/seller/availability`, { headers: { cookie } });
  html = await res.text();
  if (res.status === 200 && html.includes("w-[340px]")) { ready = true; break; }
  await new Promise((r) => setTimeout(r, 20000));
}
check(`${mode}: availability page renders the calendar widget`, ready);
check(`${mode}: AM/PM segmented control present`, html.includes("AM / PM"));
const previewMatch = /Local time: .*\d{1,2}:\d{2} (AM|PM)/.test(html);
check(`${mode}: forced-hour12 preview present`, previewMatch);
if (!previewMatch) {
  const idx = html.indexOf("Local time");
  console.log("  debug:", idx === -1 ? "no 'Local time' text" : html.slice(Math.max(0, idx - 120), idx + 200).replace(/\s+/g, " "));
}
check(`${mode}: slot shows as a calendar event dot`, html.includes("bg-[#cecdd1]"));
check(`${mode}: agenda panel present`, html.includes("No Events") || html.includes("Open slot"));
check(`${mode}: no stray datetime-local input`, !html.includes('type="datetime-local"'));

// Removal propagates on reload.
const del = await client.rpc("remove_listing_slot", { _slot_id: slot.id });
check(`${mode}: slot removed`, !del.error, del.error?.message);
const after = await (await fetch(`${site}/seller/availability`, { headers: { cookie } })).text();
check(`${mode}: event dot gone after removal`, !after.includes("bg-[#cecdd1]"));

// Timezone round-trip: the browser converts the picked wall-clock time to
// UTC before it reaches the server; the page must show the same wall time
// back (the old server-side parse shifted slots by the local offset).
const wall = new Date();
wall.setDate(wall.getDate() + 3);
wall.setHours(23, 5, 0, 0);
const tzAdd = await client.rpc("add_listing_slot", {
  _listing_id: listing.id,
  _starts_at: wall.toISOString(),
  _ends_at: new Date(wall.getTime() + 15 * 60 * 1000).toISOString(),
  _price_tokens: 100,
});
check(`${mode}: slot stored via UTC conversion`, !tzAdd.error, tzAdd.error?.message);
const tzHtml = await (await fetch(`${site}/seller/availability`, { headers: { cookie } })).text();
if (mode === "local") {
  // Local: the dev server shares this machine's timezone, so the wall
  // time must round-trip exactly.
  check("local: wall time round-trips (11:05 PM)", tzHtml.includes("11:05 PM"));
} else {
  // Live SSR renders in UTC (Vercel); hydration re-localizes. Assert the
  // event itself round-trips.
  check("live: UTC-converted slot appears in the calendar", tzHtml.includes("bg-[#cecdd1]"));
}

await admin.from("availability_slots").delete().eq("listing_id", listing.id);
await admin.from("listings").delete().eq("id", listing.id);
await admin.from("seller_profiles").delete().eq("id", profile.id);
await admin.auth.admin.deleteUser(created.user.id);

console.log(`\n${fails === 0 ? `ALL AVAILABILITY CALENDAR CHECKS PASSED (${mode})` : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
