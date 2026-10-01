/**
 * Diagnostic: simulates an older browser session (expired/bogus access
 * token + valid refresh token) hitting /admin, and reports the exact
 * status + any Next error marker in the body.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const site = "https://zclub-lime.vercel.app";
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: login, error } = await client.auth.signInWithPassword({
  email: "admin@stripclubonline.store",
  password: "oRJPsWuaPIebLAUh1xLxuwpO",
});
if (error) throw error;

const name = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
function cookieFor(session) {
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

// Simulate a session whose access token has expired: bogus token, reals
// refresh token, expires_at in the past.
const staleSession = { ...login.session, access_token: "expired.bogus.token", expires_at: 1 };
const staleCookie = cookieFor(staleSession);

for (const route of ["/admin", "/admin/settings", "/account"]) {
  const res = await fetch(site + route, { headers: { cookie: staleCookie }, redirect: "manual" });
  const body = await res.text();
  const setCookie = res.headers.getSetCookie?.() ?? [];
  console.log(
    `${res.status} ${route} | set-cookie: ${setCookie.filter((c) => c.includes("auth-token")).length} | body: ${body
      .replace(/\s+/g, " ")
      .slice(0, 200)}`
  );
}

// Sanity: valid cookie still fine.
const fresh = await fetch(site + "/admin", { headers: { cookie: cookieFor(login.session) } });
console.log(`${fresh.status} /admin (fresh session)`);
