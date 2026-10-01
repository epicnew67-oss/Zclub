/**
 * End-to-end auth verification against the running dev server + local stack.
 * Signup -> confirm via Mailpit -> login -> session cookie -> shell checks.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const site = "http://localhost:3000";
const anonHeaders = { apikey: anon, "Content-Type": "application/json" };

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

const email = `audit-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}@test.local`;
const password = "AuditPass123!";

// 1. Signup (exactly what the browser client sends: Origin + apikey).
const signupRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
  method: "POST",
  headers: { ...anonHeaders, Origin: site },
  body: JSON.stringify({ email, password, data: { display_name: "Audit User" } }),
});
const signupBody = await signupRes.json().catch(() => null);
check(
  "signup POST reaches /auth/v1/signup (200)",
  signupRes.status === 200,
  `status=${signupRes.status} body=${JSON.stringify(signupBody)?.slice(0, 200)}`
);
check(
  "CORS header present for browser origin",
  (signupRes.headers.get("access-control-allow-origin") ?? "").length > 0,
  signupRes.headers.get("access-control-allow-origin") ?? "missing"
);

// 2. User exists in Supabase auth (admin API with service key).
const adminRes = await fetch(
  `${supabaseUrl}/auth/v1/admin/users?per_page=200`,
  { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
);
const adminBody = await adminRes.json().catch(() => null);
const users = adminBody?.users ?? [];
const created = users.find((u) => u.email === email);
check("user row created in Supabase auth.users", Boolean(created), `email=${email}`);

// 3. Unconfirmed login is rejected (email confirmations ON).
const preConfirm = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: anonHeaders,
  body: JSON.stringify({ email, password }),
});
check(
  "login before email confirmation blocked",
  preConfirm.status >= 400,
  `status=${preConfirm.status}`
);

// 4. Fetch the confirmation email from Mailpit and follow the link.
let confirmed = false;
for (let attempt = 0; attempt < 8 && !confirmed; attempt++) {
  await new Promise((r) => setTimeout(r, 1200));
  const listRes = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=50");
  if (!listRes.ok) continue;
  const list = await listRes.json().catch(() => null);
  const msg = (list?.messages ?? []).find((m) =>
    JSON.stringify(m.To ?? "").includes(email)
  );
  if (!msg) continue;
  const detailRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`);
  const detail = await detailRes.json().catch(() => null);
  const text = `${detail?.Text ?? ""}\n${detail?.HTML ?? ""}`;
  const link = (text.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/) ?? [])[0];
  if (!link) continue;
  try {
    await fetch(link, { redirect: "follow" });
    confirmed = true;
  } catch {}
}
check("confirmation email found in Mailpit and link followed", confirmed);

// 5. Login now succeeds — real Supabase Auth response.
const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: anonHeaders,
  body: JSON.stringify({ email, password }),
});
const session = await loginRes.json().catch(() => null);
check(
  "sign-in returns a real session",
  loginRes.status === 200 && Boolean(session?.access_token),
  `status=${loginRes.status}`
);
check("session has refresh token (persistence)", Boolean(session?.refresh_token));

// 6. Session cookie exactly as @supabase/ssr stores it (base64- + base64url).
const cookieValue = `base64-${Buffer.from(
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

const authedFetch = (path) =>
  fetch(`${site}${path}`, {
    redirect: "manual",
    headers: { cookie: `sb-127-auth-token=${cookieValue}` },
  });

// 7. Protected route accepts the session cookie (persistence across refresh).
const accountRes = await authedFetch("/account");
check(
  "/account authorized with session cookie (refresh persistence path)",
  accountRes.status === 200,
  `status=${accountRes.status}`
);

// 8. Auth pages redirect authenticated users.
const signInAuthed = await authedFetch("/auth/sign-in");
const location = signInAuthed.headers.get("location") ?? "";
check(
  "authenticated user on /auth/sign-in redirected to /account",
  signInAuthed.status === 307 && location.includes("/account"),
  `status=${signInAuthed.status} location=${location}`
);

// 9. Authenticated shell renders (bottom nav + sign out).
const homeAuthed = await authedFetch("/");
const homeHtml = await homeAuthed.text();
check(
  "authenticated homepage shows app shell (bottom nav)",
  homeHtml.includes("fixed inset-x-0 bottom-0 z-40"),
  `status=${homeAuthed.status}`
);
check("authenticated navbar has no Design link", !homeHtml.includes('href="/design"'));

// 10. Sign out invalidates the session server-side.
const logoutRes = await fetch(`${supabaseUrl}/auth/v1/logout`, {
  method: "POST",
  headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` },
});
check("sign-out accepted", logoutRes.status === 204 || logoutRes.status === 200, `status=${logoutRes.status}`);

const afterLogout = await authedFetch("/account");
check(
  "reused cookie after sign-out is rejected",
  afterLogout.status !== 200,
  `status=${afterLogout.status}`
);

console.log(`\n${fails === 0 ? "ALL AUTH CHECKS PASSED" : `${fails} AUTH CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
