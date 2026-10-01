/**
 * Verifies the email-confirmation flow end to end on the local stack:
 * signup (PKCE) -> confirmation email via Mailpit -> follow the link ->
 * the redirect carries ?code=... -> exchange the code with the PKCE
 * verifier (exactly what the browser client does on /auth/check-email).
 *
 * The page itself calls supabase.auth.exchangeCodeForSession(code); this
 * script proves the code + verifier pair Supabase issues is exchangeable
 * and that the redirect targets our page with the code attached.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

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
const site = "http://localhost:3000";
const headers = { apikey: anon, "Content-Type": "application/json" };

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

// PKCE pair, exactly like supabase-js generates.
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

const email = `confirm-flow-${Date.now().toString(36)}@test.local`;
const password = "ConfirmFlow123!";

// 1. Sign up with the PKCE challenge (redirect_to is a query param in gotrue-js).
const redirectTarget = `${site}/auth/check-email`;
const signupRes = await fetch(
  `${base}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTarget)}`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password,
      code_challenge: challenge,
      code_challenge_method: "s256",
      data: { display_name: "Confirm Flow" },
    }),
  }
);
check("signup with PKCE challenge accepted", signupRes.status === 200, `status=${signupRes.status}`);

// 2. Grab the confirmation link from Mailpit.
let link = null;
for (let i = 0; i < 8 && !link; i++) {
  await new Promise((r) => setTimeout(r, 1200));
  const list = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=50")
    .then((r) => r.json())
    .catch(() => null);
  const msg = (list?.messages ?? []).find((m) => JSON.stringify(m.To ?? "").includes(email));
  if (!msg) continue;
  const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`)
    .then((r) => r.json())
    .catch(() => null);
  const text = `${detail?.Text ?? ""}\n${detail?.HTML ?? ""}`;
  link = (text.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/) ?? [])[0] ?? null;
}
check("confirmation email received (Mailpit)", Boolean(link));

// 3. Follow the link — it must redirect back to our page with ?code=.
let redirectTo = null;
if (link) {
  const r = await fetch(link, { redirect: "manual" });
  redirectTo = r.headers.get("location") ?? "";
  check(
    "verify redirects to /auth/check-email",
    redirectTo.includes("/auth/check-email"),
    redirectTo
  );
}
const code = redirectTo ? new URL(redirectTo).searchParams.get("code") : null;
check("redirect carries ?code= (PKCE code)", Boolean(code));

// 4. Exchange the code — the exact call the page makes.
if (code) {
  const tokenRes = await fetch(`${base}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers,
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const session = await tokenRes.json().catch(() => null);
  check(
    "exchangeCodeForSession succeeds — user is signed in after the link",
    tokenRes.status === 200 && Boolean(session?.access_token),
    `status=${tokenRes.status}`
  );
  check("session user matches the signup email", session?.user?.email === email);
  check("email is confirmed", Boolean(session?.user?.email_confirmed_at));

  // 5. Code is single-use.
  const replay = await fetch(`${base}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers,
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  check("replaying the same code is rejected", replay.status !== 200, `status=${replay.status}`);
}

console.log(`\n${fails === 0 ? "ALL CONFIRM-FLOW CHECKS PASSED" : `${fails} CONFIRM-FLOW CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
