/**
 * Verifies the role-aware navbar renders the right links for each role.
 *
 *   node scripts/verify-role-navbar.mjs local   # creates fixtures, full matrix
 *   node scripts/verify-role-navbar.mjs live    # uses the admin account
 *
 * Checks (rendered SSR HTML):
 *   owner  -> "Admin panel" present, no "Seller studio",
 *             "Become a seller" only in the footer (1 occurrence)
 *   seller -> "Seller studio" present, no "Admin panel"
 *   buyer  -> no "Admin panel", no "Seller studio",
 *             "Become a seller" in navbar + footer (>= 2 occurrences)
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2] === "live" ? "live" : "local";

function loadEnv(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const env = loadEnv(mode === "live" ? ".env.production.local" : ".env.local");
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const site = mode === "live" ? "https://zclub-lime.vercel.app" : "http://localhost:3000";
const storagePrefix = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;

const admin = createClient(base, service, { auth: { persistSession: false } });
const authClient = createClient(base, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
};

function sessionCookie(session) {
  const value = `base64-${Buffer.from(
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
  return `${storagePrefix}=${value}`;
}

async function makeUser(prefix, role) {
  const email = `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: prefix },
  });
  if (error) throw error;
  if (role) {
    const { error: roleError } = await admin
      .from("user_roles")
      .insert({ user_id: data.user.id, role });
    if (roleError) throw roleError;
  }
  const { data: login, error: loginError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginError) throw loginError;
  return sessionCookie(login.session);
}

async function pageWith(cookie) {
  const res = await fetch(site, { headers: { cookie } });
  const html = await res.text();
  const nav = (html.match(/<header[\s\S]*?<\/header>/) ?? [""])[0];
  return {
    status: res.status,
    html,
    nav,
    admins: (nav.match(/Admin panel/g) ?? []).length,
    sellers: (nav.match(/Seller studio/g) ?? []).length,
    become: (nav.match(/Become a seller/g) ?? []).length,
    accountMenu: nav.includes("Account menu"),
  };
}

if (mode === "local") {
  const owner = await pageWith(await makeUser("nav-owner", "owner"));
  const seller = await pageWith(await makeUser("nav-seller", "seller"));
  const buyer = await pageWith(await makeUser("nav-buyer", null));

  check("owner page renders 200", owner.status === 200, `status=${owner.status}`);
  check("owner: signed-in navbar", owner.accountMenu);
  check("owner: Admin panel visible", owner.admins >= 1, `nav count=${owner.admins}`);
  check("owner: no Seller studio", owner.sellers === 0, `nav count=${owner.sellers}`);
  check("owner: no recruiting link", owner.become === 0, `nav count=${owner.become}`);

  check("seller: signed-in navbar", seller.accountMenu);
  check("seller: Seller studio visible", seller.sellers >= 1, `nav count=${seller.sellers}`);
  check("seller: no Admin panel", seller.admins === 0, `nav count=${seller.admins}`);
  check("seller: no recruiting link", seller.become === 0, `nav count=${seller.become}`);

  check("buyer: signed-in navbar", buyer.accountMenu);
  check("buyer: no Admin panel", buyer.admins === 0, `nav count=${buyer.admins}`);
  check("buyer: no Seller studio", buyer.sellers === 0, `nav count=${buyer.sellers}`);
  check("buyer: navbar has Become a seller", buyer.become >= 1, `nav count=${buyer.become}`);
} else {
  const { data: login, error } = await admin.auth.signInWithPassword({
    email: "admin@stripclubonline.store",
    password: "oRJPsWuaPIebLAUh1xLxuwpO",
  });
  if (error) throw error;
  const owner = await pageWith(sessionCookie(login.session));
  check("live admin page renders 200", owner.status === 200, `status=${owner.status}`);
  check("live admin: signed-in navbar", owner.accountMenu);
  check("live admin: Admin panel visible", owner.admins >= 1, `nav count=${owner.admins}`);
  check("live admin: no Seller studio", owner.sellers === 0, `nav count=${owner.sellers}`);
  check("live admin: no recruiting link", owner.become === 0, `nav count=${owner.become}`);
}

console.log(`\n${fails === 0 ? "ALL ROLE-NAVBAR CHECKS PASSED" : `${fails} ROLE-NAVBAR CHECK(S) FAILED`} (${mode})`);
process.exit(fails === 0 ? 0 : 1);
