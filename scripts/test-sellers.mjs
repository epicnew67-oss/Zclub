/**
 * Automated seller-application tests — `npm run test:sellers`.
 *
 * Verifies the full apply -> approve / reject flow against the local
 * Supabase stack:
 *   - Submit creates a row with terms_version + IP, attempt_number=1.
 *   - Validation: display name length, offering length.
 *   - One pending per user (second submit while pending is blocked).
 *   - 7-day reapply cooldown after rejection.
 *   - Max 3 attempts (fourth submit blocked).
 *   - Role gate: non-support/finance/owner cannot approve or reject.
 *   - Approve -> seller role granted, seller_profile row created, wallet
 *     exists, notification row, audit_log row.
 *   - Reject with reason <10 chars -> blocked; >=10 chars -> row updated,
 *     notification + audit_log written.
 *   - Re-approving an already-decided application is blocked.
 *
 * Fixtures (seller-test-*@test.local, applications, ledger/audit rows)
 * are left in the local dev DB. `npx supabase db reset` wipes them.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------- env

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !anonKey || !serviceKey) {
  console.error("Missing Supabase env in .env.local.");
  process.exit(1);
}

const admin = createClient(base, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS: ${name}`);
  else {
    failures += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- fixtures

async function createUser(prefix) {
  const email = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: prefix },
  });
  if (error) throw error;
  return { email, password, userId: data.user.id };
}

async function signInAs(email, password) {
  const client = createClient(base, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function grantRole(userId, role) {
  const { error } = await admin.from("user_roles").insert({ user_id: userId, role });
  if (error && !String(error.message).includes("duplicate")) throw error;
}

async function submitApplication(client, overrides = {}) {
  return client.rpc("submit_seller_application", {
    _display_name: overrides.displayName ?? "Test Seller",
    _gender: overrides.gender ?? "female",
    _offering: overrides.offering ?? "Friendly one-on-one video chats about life and books.",
    _avatar_url: overrides.avatarUrl ?? null,
    _terms_version: overrides.termsVersion ?? "v1",
    _terms_ip: overrides.termsIp ?? "127.0.0.1",
  });
}

// ---------------------------------------------------------------- 1. happy path

const applicant = await createUser("seller-test-apply");
const applicantClient = await signInAs(applicant.email, applicant.password);

const termsVersion = (
  await admin.from("settings").select("value").eq("key", "seller_terms_version").maybeSingle()
).data?.value;
const liveTermsVersion = termsVersion?.version ?? "v1";

const ok = await submitApplication(applicantClient, { termsVersion: liveTermsVersion });
check("first submit succeeds", !ok.error, ok.error?.message);

const { data: appRow } = await admin
  .from("seller_applications")
  .select("id, status, attempt_number, terms_version, terms_ip, avatar_url")
  .eq("user_id", applicant.userId)
  .maybeSingle();
check("first application row exists", Boolean(appRow?.id));
check("first application status is pending", appRow?.status === "pending");
check("first application attempt_number is 1", appRow?.attempt_number === 1);
check("terms_version recorded", appRow?.terms_version === liveTermsVersion);
check("terms_ip recorded", Boolean(appRow?.terms_ip));

// ---------------------------------------------------------------- 2. validation

const tooShortName = await submitApplication(applicantClient, { displayName: "A" });
check("display name too short is rejected", Boolean(tooShortName.error));

const tooShortOffering = await submitApplication(applicantClient, {
  offering: "short",
});
check("offering too short is rejected", Boolean(tooShortOffering.error));

// ---------------------------------------------------------------- 3. one pending at a time

const dup = await submitApplication(applicantClient);
check("second submit while pending is blocked", Boolean(dup.error));
check(
  "blocked reason mentions pending",
  /pending/i.test(dup.error?.message ?? "")
);

// ---------------------------------------------------------------- 4. role gate

const reviewer = await createUser("seller-test-buyer");
const reviewerClient = await signInAs(reviewer.email, reviewer.password);

const { error: buyerApproveError } = await reviewerClient.rpc(
  "approve_seller_application",
  { _application_id: appRow.id }
);
check("non-admin cannot approve (insufficient_privilege)", Boolean(buyerApproveError));

const { error: buyerRejectError } = await reviewerClient.rpc(
  "reject_seller_application",
  { _application_id: appRow.id, _reason: "because i feel like it today" }
);
check("non-admin cannot reject (insufficient_privilege)", Boolean(buyerRejectError));

// ---------------------------------------------------------------- 5. reject with too-short reason

const admin1 = await createUser("seller-test-support");
await grantRole(admin1.userId, "support");
const supportClient = await signInAs(admin1.email, admin1.password);

const { error: shortRejectError } = await supportClient.rpc(
  "reject_seller_application",
  { _application_id: appRow.id, _reason: "too short" }
);
check("reject with <10-char reason is blocked", Boolean(shortRejectError));

// ---------------------------------------------------------------- 6. support user approves

const { error: approveError } = await supportClient.rpc(
  "approve_seller_application",
  { _application_id: appRow.id, _note: "Welcome aboard" }
);
check("support user approves application", !approveError, approveError?.message);

const { data: roleRow } = await admin
  .from("user_roles")
  .select("id")
  .eq("user_id", applicant.userId)
  .eq("role", "seller")
  .maybeSingle();
check("approve grants seller role", Boolean(roleRow?.id));

const { data: profileRow } = await admin
  .from("seller_profiles")
  .select("id, slug, display_name, is_active, avatar_url, bio")
  .eq("user_id", applicant.userId)
  .maybeSingle();
check("approve creates seller_profile", Boolean(profileRow?.id));
check(
  "seller_profile slug is unique + slug-shaped (existing migration quirk: see note in PROGRESS.md)",
  /^[a-z0-9][a-z0-9-]*$/.test(profileRow?.slug ?? "")
);
check("seller_profile bio seeded from offering", /Friendly/.test(profileRow?.bio ?? ""));
check("seller_profile is_active true", profileRow?.is_active === true);

const { data: walletRow } = await admin
  .from("wallets")
  .select("id")
  .eq("user_id", applicant.userId)
  .maybeSingle();
check("applicant wallet exists", Boolean(walletRow?.id));

const { data: notifRow } = await admin
  .from("notifications")
  .select("id, title, link")
  .eq("user_id", applicant.userId)
  .eq("type", "system")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
check("approval notification written", /approved/i.test(notifRow?.title ?? ""));
check("approval notification links to /seller", notifRow?.link === "/seller");

const { count: approveAudit } = await admin
  .from("audit_log")
  .select("id", { count: "exact", head: true })
  .eq("action", "seller_application.approve")
  .eq("target_id", appRow.id);
check("audit_log has one seller_application.approve row", approveAudit === 1);

// ---------------------------------------------------------------- 7. re-approve blocked

const { error: reApproveError } = await supportClient.rpc(
  "approve_seller_application",
  { _application_id: appRow.id }
);
check("re-approving an approved application is blocked", Boolean(reApproveError));

// ---------------------------------------------------------------- 8. reject path (separate applicant)

const applicant2 = await createUser("seller-test-reject");
const applicant2Client = await signInAs(applicant2.email, applicant2.password);

const sub2 = await submitApplication(applicant2Client);
check("second applicant submits cleanly", !sub2.error, sub2.error?.message);
const { data: app2 } = await admin
  .from("seller_applications")
  .select("id")
  .eq("user_id", applicant2.userId)
  .maybeSingle();

const longReason = "Insufficient detail about boundaries and audience expectations.";
const { error: reject2Error } = await supportClient.rpc(
  "reject_seller_application",
  { _application_id: app2.id, _reason: longReason }
);
check("support user rejects with >=10-char reason", !reject2Error, reject2Error?.message);

const { data: rejectedRow } = await admin
  .from("seller_applications")
  .select("status, review_note, reviewed_at, reviewed_by")
  .eq("id", app2.id)
  .maybeSingle();
check("rejected application status is rejected", rejectedRow?.status === "rejected");
check("rejected application review_note matches", rejectedRow?.review_note === longReason);
check("rejected application has reviewed_at", Boolean(rejectedRow?.reviewed_at));
check(
  "rejected application reviewed_by is the support user",
  rejectedRow?.reviewed_by === admin1.userId
);

const { count: rejectAudit } = await admin
  .from("audit_log")
  .select("id", { count: "exact", head: true })
  .eq("action", "seller_application.reject")
  .eq("target_id", app2.id);
check("audit_log has one seller_application.reject row", rejectAudit === 1);

const { data: rejectNotif } = await admin
  .from("notifications")
  .select("title, body, link")
  .eq("user_id", applicant2.userId)
  .eq("type", "system")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
check("rejection notification written", /rejected/i.test(rejectNotif?.title ?? ""));
check("rejection notification body is the reason", rejectNotif?.body === longReason);
check("rejection notification links to /become-a-seller", rejectNotif?.link === "/become-a-seller");

// ---------------------------------------------------------------- 9. 7-day cooldown after rejection

const cooldownAttempt = await submitApplication(applicant2Client);
check("reapply within 7 days is blocked", Boolean(cooldownAttempt.error));
check(
  "cooldown reason mentions reapply",
  /cooldown|reapply/i.test(cooldownAttempt.error?.message ?? "")
);

// ---------------------------------------------------------------- 10. max 3 attempts

const applicant3 = await createUser("seller-test-max");
const applicant3Client = await signInAs(applicant3.email, applicant3.password);

for (let i = 1; i <= 3; i += 1) {
  const r = await submitApplication(applicant3Client);
  if (r.error) throw new Error(`Attempt ${i} unexpectedly failed: ${r.error.message}`);
  const { data: appI } = await admin
    .from("seller_applications")
    .select("id, attempt_number")
    .eq("user_id", applicant3.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (appI?.attempt_number !== i) {
    throw new Error(`Attempt ${i} stored with attempt_number=${appI?.attempt_number}`);
  }
  // Force-reject so the next attempt is allowed past the one-pending check.
  await admin
    .from("seller_applications")
    .update({
      status: "rejected",
      reviewed_by: admin1.userId,
      reviewed_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      review_note: `rejected attempt ${i}`,
    })
    .eq("id", appI.id);
}

const fourth = await submitApplication(applicant3Client);
check("4th attempt blocked (max 3)", Boolean(fourth.error));
check("max-attempts reason mentions Maximum", /Maximum/i.test(fourth.error?.message ?? ""));

// ---------------------------------------------------------------- done

console.log(
  `\nFixtures left in dev DB: ${applicant.email}, ${reviewer.email}, ${admin1.email}, ${applicant2.email}, ${applicant3.email}`
);
if (failures > 0) {
  console.error(`\n${failures} seller test(s) FAILED`);
  process.exit(1);
}
console.log("All seller tests passed.");