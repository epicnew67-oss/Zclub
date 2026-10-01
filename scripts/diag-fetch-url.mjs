/**
 * Diagnostic: fetch one URL with the live admin session.
 *   node scripts/diag-fetch-url.mjs "/finance/topups?id=..." [email] [password]
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
const path = process.argv[2] ?? "/admin";
const email = process.argv[3] ?? "admin@stripclubonline.store";
const password = process.argv[4] ?? "oRJPsWuaPIebLAUh1xLxuwpO";

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: login, error } = await client.auth.signInWithPassword({ email, password });
if (error) throw error;

const name = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const cookie = `${name}=base64-${Buffer.from(
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

const res = await fetch(site + path, { headers: { cookie }, redirect: "manual" });
const body = await res.text();
console.log(`status ${res.status} ${path}`);
if (res.status >= 400) {
  console.log(body.replace(/\s+/g, " ").slice(0, 800));
} else {
  console.log(body.replace(/\s+/g, " ").slice(0, 400));
}
