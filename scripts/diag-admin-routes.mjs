/**
 * Diagnostic: fetches every admin/finance route with the live admin
 * session and reports status codes so we can pinpoint a 500.
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

const value = `base64-${Buffer.from(
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
const name = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const cookie = `${name}=${value}`;

const routes = [
  "/admin",
  "/admin/customers",
  "/admin/sellers",
  "/admin/listings",
  "/admin/disputes",
  "/admin/chat-logs",
  "/admin/topups",
  "/admin/payouts",
  "/admin/reports",
  "/admin/audit",
  "/admin/settings",
  "/finance",
  "/finance/topups",
  "/finance/payouts",
  "/account",
];

for (const route of routes) {
  try {
    const res = await fetch(site + route, { headers: { cookie }, redirect: "manual" });
    const body = await res.text();
    const note = res.status >= 300 && res.status < 400 ? `-> ${res.headers.get("location")}` : "";
    const err = res.status >= 500 ? ` | ${body.replace(/\s+/g, " ").slice(0, 220)}` : "";
    console.log(`${res.status} ${route}${note}${err}`);
  } catch (e) {
    console.log(`ERR ${route} — ${e.message}`);
  }
}
