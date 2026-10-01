/**
 * Verifies the seller "Submit for review" UX on /seller/listings:
 *   - draft listings show the one-click submit button
 *   - photo-less drafts are disabled with a clear "add a photo" hint
 *     (the DB refuses photo-less submissions)
 *
 *   node scripts/verify-seller-submit-ui.mjs
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
const authClient = createClient(base, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

const stamp = Date.now().toString(36);
const email = `submit-ui-${stamp}@test.local`;
const password = `Pw-${randomUUID()}`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: `submit-ui-display-${stamp}` },
});
if (createErr) throw createErr;
const userId = created.user.id;
await admin.from("user_roles").insert({ user_id: userId, role: "seller" });

const { data: seller, error: sellerErr } = await admin
  .from("seller_profiles")
  .insert({
    user_id: userId,
    slug: `submit-ui-${stamp}`,
    display_name: `submit-ui-display-${stamp}`,
  })
  .select("id")
  .single();
if (sellerErr) throw sellerErr;

const { data: withPhoto, error: withPhotoErr } = await admin
  .from("listings")
  .insert({
    seller_id: seller.id,
    title: `Submit UI with photo ${stamp}`,
    description: "Has a photo row so submission is enabled.",
    price_tokens: 100,
    duration_minutes: 15,
    status: "draft",
    is_active: false,
  })
  .select("id")
  .single();
if (withPhotoErr) throw withPhotoErr;
await admin
  .from("listing_photos")
  .insert({ listing_id: withPhoto.id, path: `${userId}/fake-${stamp}.jpg`, sort_order: 0 });

const { data: noPhoto, error: noPhotoErr } = await admin
  .from("listings")
  .insert({
    seller_id: seller.id,
    title: `Submit UI no photo ${stamp}`,
    description: "No photo yet — the submit button must be disabled.",
    price_tokens: 100,
    duration_minutes: 15,
    status: "draft",
    is_active: false,
  })
  .select("id")
  .single();
if (noPhotoErr) throw noPhotoErr;

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

const page = await fetch(`${origin}/seller/listings`, { headers: { cookie } });
const html = await page.text();
check("seller listings renders 200", page.status === 200, `status=${page.status}`);
check("photo draft card renders", html.includes(`Submit UI with photo ${stamp}`));
check("no-photo draft card renders", html.includes(`Submit UI no photo ${stamp}`));
check("submit button present", html.includes("Submit for review"));
check("no-photo draft shows the hint", html.includes("Add at least one photo first"));

// The disabled state must be on the no-photo card: the button sits
// immediately before the hint text inside the same wrapper.
const hintIdx = html.indexOf("Add at least one photo first");
const beforeHint = html.slice(Math.max(0, hintIdx - 400), hintIdx);
check(
  "no-photo submit button is disabled",
  hintIdx !== -1 && beforeHint.includes("disabled"),
  "disabled attribute not found before the hint"
);

// ---------------------------------------------------------------- cleanup
await admin.from("listing_photos").delete().eq("listing_id", withPhoto.id);
await admin.from("listings").delete().in("id", [withPhoto.id, noPhoto.id]);
await admin.from("seller_profiles").delete().eq("id", seller.id);
await admin.auth.admin.deleteUser(userId);

console.log(`\n${fails === 0 ? "ALL SELLER SUBMIT-UI CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
