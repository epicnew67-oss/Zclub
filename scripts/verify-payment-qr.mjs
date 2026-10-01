/**
 * Verifies the payment-QR upload feature against the LOCAL stack:
 *   - storage policies (owner can write, buyer cannot, delete works)
 *   - bucket-enforced limits (mime types, 5 MB size)
 *   - the settings RPC stores the public URL (schema preserved)
 *   - the customer top-up page embeds the uploaded QR automatically
 *   - the admin settings page renders the uploader (no base64 text input)
 *
 *   node scripts/verify-payment-qr.mjs
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
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const origin = "http://localhost:3000";
const BUCKET = "payment-qr";
const admin = createClient(base, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function makeUserClient(tag, role) {
  const email = `${tag}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: tag },
  });
  if (error) throw error;
  if (role) {
    const { error: roleError } = await admin
      .from("user_roles")
      .insert({ user_id: data.user.id, role });
    if (roleError) throw roleError;
  }
  const client = createClient(base, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
  if (loginErr) throw loginErr;
  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData.session;
  const cookieName = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;
  const cookie = `${cookieName}=base64-${Buffer.from(
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
  return { id: data.user.id, email, client, cookie };
}

const owner = await makeUserClient("qr-owner", "owner");
const buyer = await makeUserClient("qr-buyer", null);

// ---------------------------------------------------------------- policies
const buyerUpload = await buyer.client.storage
  .from(BUCKET)
  .upload(`jazzcash/buyer-${Date.now()}.png`, new Blob([PNG_1PX], { type: "image/png" }), {
    contentType: "image/png",
  });
check("buyer upload denied by storage policy", Boolean(buyerUpload.error), JSON.stringify(buyerUpload.error));

const path = `jazzcash/verify-${Date.now()}.png`;
const ownerUpload = await owner.client.storage
  .from(BUCKET)
  .upload(path, new Blob([PNG_1PX], { type: "image/png" }), { contentType: "image/png" });
check("owner upload succeeds", !ownerUpload.error, ownerUpload.error?.message);

const { data: pub } = owner.client.storage.from(BUCKET).getPublicUrl(path);
const publicUrl = pub.publicUrl;
const served = await fetch(publicUrl);
check(
  "public URL serves the image",
  served.status === 200 && (served.headers.get("content-type") ?? "").includes("image/png"),
  `status=${served.status}`
);

const badType = await owner.client.storage
  .from(BUCKET)
  .upload(`jazzcash/bad-${Date.now()}.txt`, new Blob(["not an image"], { type: "text/plain" }), {
    contentType: "text/plain",
  });
check("non-image rejected (bucket mime types)", Boolean(badType.error), JSON.stringify(badType.error));

const oversize = await owner.client.storage
  .from(BUCKET)
  .upload(
    `jazzcash/big-${Date.now()}.png`,
    new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }),
    { contentType: "image/png" }
  );
check("oversize rejected (bucket 5 MB limit)", Boolean(oversize.error), JSON.stringify(oversize.error));

// ---------------------------------------------------------------- settings
const { data: before } = await admin
  .from("settings")
  .select("value")
  .eq("key", "jazzcash")
  .single();
const originalQr = before.value.qr_data_url ?? null;

const commit = await owner.client.rpc("admin_payment_details_update", {
  _provider: "jazzcash",
  _account_name: before.value.account_name ?? null,
  _account_number: before.value.account_number ?? null,
  _instructions: before.value.instructions ?? null,
  _qr_data_url: publicUrl,
});
check(
  "settings RPC accepts the QR URL",
  !commit.error && commit.data?.ok !== false,
  JSON.stringify(commit.error ?? commit.data).slice(0, 200)
);

const { data: after } = await admin
  .from("settings")
  .select("value")
  .eq("key", "jazzcash")
  .single();
check("settings row stores the public URL", after.value.qr_data_url === publicUrl);

// ---------------------------------------------------------------- customer flow
const page = await fetch(`${origin}/wallet/topup`, { headers: { cookie: owner.cookie } });
const html = await page.text();
check("customer flow embeds the uploaded QR URL", html.includes(publicUrl));

// ---------------------------------------------------------------- admin UI
const settingsPage = await fetch(`${origin}/admin/settings`, { headers: { cookie: owner.cookie } });
const settingsHtml = await settingsPage.text();
check("/admin/settings renders 200", settingsPage.status === 200, `status=${settingsPage.status}`);
check("Payment tab present", settingsHtml.includes("Payment"));

// The Payment tab renders client-side; verify the shipped bundle contains
// the uploader and no longer the base64 text input.
const scriptSrcs = [...settingsHtml.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
let foundUploader = false;
let foundOldInput = false;
for (const src of scriptSrcs.slice(0, 60)) {
  const res = await fetch(new URL(src, origin));
  const text = await res.text();
  if (text.includes("Upload QR code")) foundUploader = true;
  if (text.includes("QR data URL (image/png")) foundOldInput = true;
}
check("bundle ships the QR uploader", foundUploader);
check("base64 text input removed", !foundOldInput);

// ---------------------------------------------------------------- cleanup
const restore = await owner.client.rpc("admin_payment_details_update", {
  _provider: "jazzcash",
  _account_name: before.value.account_name ?? null,
  _account_number: before.value.account_number ?? null,
  _instructions: before.value.instructions ?? null,
  _qr_data_url: originalQr,
});
check("settings restored", !restore.error);
const removed = await owner.client.storage.from(BUCKET).remove([path]);
check("owner delete succeeds (policy used in cleanup)", !removed.error, removed.error?.message);

console.log(`\n${fails === 0 ? "ALL PAYMENT QR CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
