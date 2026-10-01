/**
 * Verifies the admin dashboard renders live data (or honest zeros) —
 * never a stuck "Loading…" or "—" value. Covers the service-role →
 * session-client regression that 403'd on cloud.
 *
 *   node scripts/verify-admin-dashboard.mjs local
 *   node scripts/verify-admin-dashboard.mjs live
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

let cookie;
if (mode === "live") {
  const { data: login, error } = await authClient.auth.signInWithPassword({
    email: "admin@stripclubonline.store",
    password: "oRJPsWuaPIebLAUh1xLxuwpO",
  });
  if (error) throw error;
  cookie = sessionCookie(login.session);
} else {
  const email = `nav-owner-diag-${Date.now().toString(36)}@test.local`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "dashboard diag" },
  });
  if (error) throw error;
  const { error: roleError } = await admin
    .from("user_roles")
    .insert({ user_id: data.user.id, role: "owner" });
  if (roleError) throw roleError;
  const { data: login, error: loginError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginError) throw loginError;
  cookie = sessionCookie(login.session);
}

const res = await fetch(`${site}/admin`, { headers: { cookie } });
const html = await res.text();

check("admin dashboard renders 200", res.status === 200, `status=${res.status}`);
check("pending queues panel present", html.includes("Pending queues"));
check("all four queue links present",
  ["Listings to review", "Seller applications", "Payouts pending", "Open disputes"].every((l) => html.includes(l)));
check("no stuck 'Loading…' placeholder", !html.includes("Loading…"));
check("no '—' value placeholders", !html.includes(">—<"));

const salesMatch = html.match(/Sales · 30d \(tokens\)<\/div><div[^>]*>([\d,]+)</);
check("sales stat renders a number", Boolean(salesMatch), "no numeric sales value found");
const queueMatch = html.match(/Listings to review<\/span><span[^>]*>(\d+)</);
check("queue count renders a number", Boolean(queueMatch));

const reports = await fetch(`${site}/admin/reports`, { headers: { cookie } });
const reportsHtml = await reports.text();
check("reports page renders 200", reports.status === 200, `status=${reports.status}`);
check("reports dispute rate renders a percent", /\d+\.\d\d%/.test(reportsHtml));
check("reports has no '—' placeholders", !reportsHtml.includes(">—<"));

// Finance top-ups queue — the page behind "New top-up request" admin
// notifications. Regression: an ambiguous profiles embed (PGRST201)
// crashed this page after the shell streamed ("This page couldn't load").
const queue = await fetch(`${site}/finance/topups`, { headers: { cookie } });
const queueHtml = await queue.text();
check("finance topups renders 200", queue.status === 200, `status=${queue.status}`);
check(
  "finance topups: queue or empty state rendered",
  queueHtml.includes("credit once") || queueHtml.includes("All clear"),
  "neither queue cards nor empty state found"
);
check("finance topups: no route error boundary", !queueHtml.includes("Something went"), "");
check("finance topups: no Next error screen", !queueHtml.includes("couldn't load"));

console.log(
  `\n${fails === 0 ? "ALL ADMIN DASHBOARD CHECKS PASSED" : `${fails} ADMIN DASHBOARD CHECK(S) FAILED`} (${mode})`
);
process.exit(fails === 0 ? 0 : 1);
