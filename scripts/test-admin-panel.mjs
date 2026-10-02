/**
 * Admin panel tests — `npm run test:admin-panel`.
 *
 * Covers the role-based admin surface:
 *   A: dashboard stats — owner ok, buyer insufficient_privilege
 *   B: customer search — owner finds by display_name
 *   C: ban + unban — support sets is_banned, audit row written
 *   D: soft-delete blocks escrow; cancel booking, retry ok
 *   E: owner-only wallet adjust — support insufficient, owner ok
 *   F: chat-log requires reason (≥10 chars); reason written to audit
 *   G: chat-log retention — back-dated booking filtered out
 *   H: settings ownership — support ok on non-money, finance refused on commission
 *   I: token-pack price is owner-only
 *   J: audit log viewer finds rows
 *
 * Each role gets the role it needs; cross-role attempts must be refused.
 * Fixtures stay in the local dev DB (append-only ledger + never-hard-delete).
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(
      (line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")
    )
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

async function createUser(prefix) {
  const email = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
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

async function makeUserWithRole(role) {
  const u = await createUser(`ap-test-${role}`);
  await grantRole(u.userId, role);
  return u;
}

async function makeApprovedSeller(prefix) {
  const u = await createUser(prefix);
  await grantRole(u.userId, "support");
  const supportClient = await signInAs(u.email, u.password);
  const client = await signInAs(u.email, u.password);
  const termsVersion =
    (
      await admin
        .from("settings")
        .select("value")
        .eq("key", "seller_terms_version")
        .maybeSingle()
    )?.data?.value?.version ?? "v1";
  await client.rpc("submit_seller_application", {
    _display_name: `${prefix}-display`,
    _gender: "female",
    _offering: `Friendly ${prefix} chats about books, movies, and life goals.`,
    _avatar_url: null,
    _terms_version: termsVersion,
    _terms_ip: "127.0.0.1",
  });
  const { data: appRow } = await admin
    .from("seller_applications")
    .select("id")
    .eq("user_id", u.userId)
    .maybeSingle();
  if (!appRow) throw new Error("application not visible");
  await supportClient.rpc("approve_seller_application", {
    _application_id: appRow.id,
    _note: null,
  });
  return { email: u.email, password: u.password, userId: u.userId, client };
}

async function makeBuyer(prefix) {
  const u = await createUser(prefix);
  const client = await signInAs(u.email, u.password);
  return { ...u, client };
}

async function creditWallet(userId, amount) {
  const { error } = await admin.rpc("wallet_credit", {
    _user_id: userId,
    _amount: amount,
    _entry_type: "support_adjustment",
    _ref_type: "support",
    _ref_id: randomUUID(),
    _description: "test fixture",
    _created_by: null,
  });
  if (error) throw error;
}

async function makeListingAndSlot(seller, buyer, priceTokens = 500, durationMinutes = 30) {
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .eq("slug", "companionship")
    .maybeSingle();
  const { data: sp } = await admin
    .from("seller_profiles")
    .select("id")
    .eq("user_id", seller.userId)
    .maybeSingle();
  const { data: listing } = await admin
    .from("listings")
    .insert({
      seller_id: sp.id,
      category_id: cat?.id ?? null,
      title: `Test listing ${Date.now().toString(36)}`,
      description: "A friendly chat for the admin test suite.",
      price_tokens: priceTokens,
      duration_minutes: durationMinutes,
      status: "approved",
      is_active: true,
    })
    .select("id")
    .single();
  const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const endsAt = new Date(Date.now() + (5 + durationMinutes) * 60_000).toISOString();
  const { data: slot } = await admin
    .from("availability_slots")
    .insert({
      listing_id: listing.id,
      starts_at: startsAt,
      ends_at: endsAt,
      price_tokens: priceTokens,
      status: "open",
    })
    .select("id")
    .single();
  await creditWallet(buyer.userId, priceTokens * 2);
  const purchase = await buyer.client.rpc("purchase_slot", { _slot_id: slot.id });
  if (!purchase.data?.ok) throw new Error(`purchase failed: ${JSON.stringify(purchase.data)}`);
  return purchase.data.booking_id;
}

async function completeBooking(bookingId, minutesAgo) {
  await admin
    .from("bookings")
    .update({
      status: "completed",
      live_ended_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      live_started_at: new Date(Date.now() - (minutesAgo + 1) * 60_000).toISOString(),
      seller_joined_at: new Date(Date.now() - (minutesAgo + 1) * 60_000).toISOString(),
      buyer_joined_at: new Date(Date.now() - (minutesAgo + 1) * 60_000).toISOString(),
    })
    .eq("id", bookingId);
}

// ---------------------------------------------------------------- cases

async function caseA_dashboardStats() {
  console.log("\n== Case A: admin_dashboard_stats ==");
  const owner = await makeUserWithRole("owner");
  const ownerClient = await signInAs(owner.email, owner.password);
  const r1 = await ownerClient.rpc("admin_dashboard_stats");
  check("A.1 owner can read stats", r1.data?.pending_queues != null, JSON.stringify(r1.data));
  check("A.2 bookings_by_state present", typeof r1.data?.bookings_by_state === "object");

  const buyer = await makeBuyer("ap-test-buyer");
  const r2 = await buyer.client.rpc("admin_dashboard_stats");
  // raises insufficient_privilege -> PostgREST error
  check(
    "A.3 buyer refused",
    !!r2.error && /admin role required|insufficient_privilege|permission|privilege/i.test(String(r2.error?.message ?? "")),
    JSON.stringify({ error: r2.error?.message, data: r2.data })
  );
}

async function caseB_userSearch() {
  console.log("\n== Case B: admin_user_search ==");
  const owner = await makeUserWithRole("owner");
  const ownerClient = await signInAs(owner.email, owner.password);
  const marker = `ap-test-search-${Date.now().toString(36)}`;
  const u = await createUser(marker);
  // give it a known display_name
  await admin.from("profiles").update({ display_name: marker }).eq("id", u.userId);

  const r = await ownerClient.rpc("admin_user_search", { _query: marker, _limit: 10, _offset: 0 });
  check("B.1 search returns row", Array.isArray(r.data?.rows) && r.data.rows.length >= 1, JSON.stringify(r.data));
  check(
    "B.2 matched display_name",
    r.data?.rows?.[0]?.display_name === marker,
    r.data?.rows?.[0]?.display_name
  );
}

async function caseC_banUnban() {
  console.log("\n== Case C: admin_set_user_ban ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const buyer = await makeBuyer("ap-test-buyer");

  const r1 = await supportClient.rpc("admin_set_user_ban", {
    _user_id: buyer.userId,
    _banned: true,
    _note: "Test ban — automated suite.",
  });
  check("C.1 ban ok", r1.data?.ok === true, JSON.stringify(r1.data));

  const { data: profile } = await admin
    .from("profiles")
    .select("is_banned")
    .eq("id", buyer.userId)
    .maybeSingle();
  check("C.2 profile.is_banned = true", profile?.is_banned === true, String(profile?.is_banned));

  const { data: audits } = await admin
    .from("audit_log")
    .select("id, action")
    .eq("target_id", buyer.userId)
    .eq("action", "user.ban");
  check("C.3 audit_log row written", (audits?.length ?? 0) >= 1, JSON.stringify(audits));

  // Unban
  const r2 = await supportClient.rpc("admin_set_user_ban", {
    _user_id: buyer.userId,
    _banned: false,
    _note: null,
  });
  check("C.4 unban ok", r2.data?.ok === true, JSON.stringify(r2.data));

  const { data: profile2 } = await admin
    .from("profiles")
    .select("is_banned")
    .eq("id", buyer.userId)
    .maybeSingle();
  check("C.5 is_banned = false again", profile2?.is_banned === false);
}

async function caseD_softDeleteBlocksEscrow() {
  console.log("\n== Case D: admin_soft_delete_seller blocks escrow ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const seller = await makeApprovedSeller("ap-test-seller");
  const buyer = await makeBuyer("ap-test-buyer");
  const bookingId = await makeListingAndSlot(seller, buyer);

  const r1 = await supportClient.rpc("admin_soft_delete_seller", { _seller_user_id: seller.userId });
  check(
    "D.1 blocked with escrow_pending",
    r1.data?.code === "escrow_pending",
    JSON.stringify(r1.data)
  );

  // Cancel the booking and retry
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);
  const r2 = await supportClient.rpc("admin_soft_delete_seller", { _seller_user_id: seller.userId });
  check("D.2 ok after cancellation", r2.data?.ok === true, JSON.stringify(r2.data));
}

async function caseE_walletAdjustOwnership() {
  console.log("\n== Case E: admin_wallet_adjust owner-only ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const owner = await makeUserWithRole("owner");
  const ownerClient = await signInAs(owner.email, owner.password);
  const buyer = await makeBuyer("ap-test-buyer");

  const r1 = await supportClient.rpc("admin_wallet_adjust", {
    _user_id: buyer.userId,
    _amount: 100,
    _reason: "Test support reason — should be refused because support role.",
  });
  check(
    "E.1 support refused (owner required)",
    !!r1.error && /owner required|insufficient_privilege|privilege/i.test(String(r1.error?.message ?? "")),
    JSON.stringify({ err: r1.error?.message, data: r1.data })
  );

  const r2 = await ownerClient.rpc("admin_wallet_adjust", {
    _user_id: buyer.userId,
    _amount: 200,
    _reason: "Owner adjustment — automated suite fixture credit.",
  });
  check("E.2 owner adjust ok", r2.data?.ok === true, JSON.stringify(r2.data));
  check(
    "E.3 balance returned = 200",
    r2.data?.balance === 200,
    `got=${r2.data?.balance}`
  );

  const r3 = await ownerClient.rpc("admin_wallet_adjust", {
    _user_id: buyer.userId,
    _amount: 50,
    _reason: "short",
  });
  check("E.4 short reason refused", r3.data?.code === "note_too_short", JSON.stringify(r3.data));
}

async function caseF_chatLogReason() {
  console.log("\n== Case F: admin_get_chat_log requires reason ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const seller = await makeApprovedSeller("ap-test-seller");
  const buyer = await makeBuyer("ap-test-buyer");
  const bookingId = await makeListingAndSlot(seller, buyer);
  await completeBooking(bookingId, 30 * 60);

  // Send a chat message so there's something to view
  await buyer.client.rpc("send_chat_message", {
    _chat_id: (
      await admin.from("booking_chats").select("id").eq("booking_id", bookingId).maybeSingle()
    )?.data?.id,
    _body: "Hello from the buyer — admin chat log test fixture.",
  });

  const r1 = await supportClient.rpc("admin_get_chat_log", {
    _booking_id: bookingId,
    _reason: "short",
  });
  check("F.1 short reason refused", r1.data?.code === "reason_too_short", JSON.stringify(r1.data));

  const r2 = await supportClient.rpc("admin_get_chat_log", {
    _booking_id: bookingId,
    _reason: "Routine support investigation — reviewing chat per dispute policy.",
  });
  check("F.2 ok with reason", r2.data?.ok === true, JSON.stringify(r2.data));
  check(
    "F.3 messages returned",
    Array.isArray(r2.data?.messages) && r2.data.messages.length >= 1,
    JSON.stringify(r2.data?.messages)
  );

  const { data: audit } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", "chat_log.view")
    .eq("target_id", bookingId);
  check("F.4 audit row written", (audit?.length ?? 0) >= 1, JSON.stringify(audit));
}

async function caseG_chatLogRetention() {
  console.log("\n== Case G: chat log retention filter ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const seller = await makeApprovedSeller("ap-test-seller");
  const buyer = await makeBuyer("ap-test-buyer");
  const bookingId = await makeListingAndSlot(seller, buyer);

  // Back-date by 100 days — past the 90-day default retention.
  await admin
    .from("bookings")
    .update({
      status: "completed",
      live_ended_at: new Date(Date.now() - 100 * 24 * 60 * 60_000).toISOString(),
    })
    .eq("id", bookingId);

  const r = await supportClient.rpc("admin_list_chat_log_bookings");
  const ids = (r.data?.rows ?? []).map((row) => row.booking_id);
  check("G.1 back-dated booking filtered out", !ids.includes(bookingId), `rows=${ids.length}`);

  // Direct RPC with valid reason should refuse retention_expired
  const r2 = await supportClient.rpc("admin_get_chat_log", {
    _booking_id: bookingId,
    _reason: "Test reason for retention check.",
  });
  check(
    "G.2 retention_expired code",
    r2.data?.code === "retention_expired",
    JSON.stringify(r2.data)
  );
}

async function caseH_settingsOwnership() {
  console.log("\n== Case H: settings ownership ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const owner = await makeUserWithRole("owner");
  const ownerClient = await signInAs(owner.email, owner.password);

  // Support updates a non-money setting
  const r1 = await supportClient.rpc("admin_settings_update", {
    _key: "cancellation_policy",
    _value: { buyer_full_refund_hours: 24, buyer_partial_refund_pct: 50 },
  });
  check("H.1 support non-money ok", r1.data?.ok === true, JSON.stringify(r1.data));
  check("H.2 is_money = false", r1.data?.is_money === false);

  // Finance tries to update commission
  const finance = await makeUserWithRole("finance");
  const financeClient = await signInAs(finance.email, finance.password);
  const r2 = await financeClient.rpc("admin_settings_update", {
    _key: "commission",
    _value: { pct: 17 },
  });
  check(
    "H.3 finance refused on money key",
    !!r2.error && /insufficient_privilege|owner/i.test(String(r2.error?.message ?? "")),
    JSON.stringify({ err: r2.error?.message, data: r2.data })
  );

  const r3 = await ownerClient.rpc("admin_settings_update", {
    _key: "commission",
    _value: { pct: 17 },
  });
  check("H.4 owner commission ok", r3.data?.ok === true, JSON.stringify(r3.data));
  check("H.5 is_money = true", r3.data?.is_money === true);

  const { data: audits } = await admin
    .from("audit_log")
    .select("id, details")
    .eq("action", "setting.update")
    .order("id", { ascending: false })
    .limit(3);
  const commissionAudit = (audits ?? []).find((a) =>
    JSON.stringify(a.details ?? {}).includes("commission")
  );
  check("H.6 commission audit row written", !!commissionAudit, JSON.stringify(audits?.length));

  // Restore the default commission so we don't pollute later test runs.
  await ownerClient.rpc("admin_settings_update", {
    _key: "commission",
    _value: { pct: 10 },
  });
}

async function caseI_tokenPackPrice() {
  console.log("\n== Case I: token pack price owner-only ==");
  const support = await makeUserWithRole("support");
  const supportClient = await signInAs(support.email, support.password);
  const owner = await makeUserWithRole("owner");
  const ownerClient = await signInAs(owner.email, owner.password);

  const { data: pack } = await admin
    .from("token_packs")
    .select("id, price_pkr")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!pack) throw new Error("no token_packs seeded");

  // Support cannot change price
  const r1 = await supportClient.rpc("admin_token_pack_set_price", {
    _id: pack.id,
    _price_pkr: 999,
  });
  check(
    "I.1 support refused on price",
    !!r1.error && /insufficient_privilege|owner/i.test(String(r1.error?.message ?? "")),
    JSON.stringify({ err: r1.error?.message, data: r1.data })
  );

  // Owner change
  const r2 = await ownerClient.rpc("admin_token_pack_set_price", {
    _id: pack.id,
    _price_pkr: 999,
  });
  check("I.2 owner price change ok", r2.data?.ok === true, JSON.stringify(r2.data));
  check("I.3 old/new returned", typeof r2.data?.old === "number" && r2.data?.new === 999);

  // Restore
  await ownerClient.rpc("admin_token_pack_set_price", { _id: pack.id, _price_pkr: pack.price_pkr });

  // Support toggles active (allowed)
  const { data: pack2 } = await admin
    .from("token_packs")
    .select("id, is_active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const r3 = await supportClient.rpc("admin_token_pack_set_active", {
    _id: pack2.id,
    _active: !pack2.is_active,
  });
  check("I.4 support toggle active ok", r3.data?.ok === true, JSON.stringify(r3.data));
  // restore
  await supportClient.rpc("admin_token_pack_set_active", {
    _id: pack2.id,
    _active: pack2.is_active,
  });
}

async function caseJ_auditLogViewer() {
  console.log("\n== Case J: audit log viewer ==");
  const owner = await makeUserWithRole("owner");
  const ownerClient = await signInAs(owner.email, owner.password);
  const r = await ownerClient.rpc("admin_list_audit_log", {
    _action_filter: "user.ban",
    _target_type: null,
    _limit: 50,
    _offset: 0,
  });
  const rows = r.data?.rows ?? [];
  check("J.1 audit_log returns rows", rows.length >= 1, JSON.stringify({ count: rows.length }));
  check(
    "J.2 row has expected shape",
    typeof rows[0]?.action === "string" && typeof rows[0]?.actor_name !== "undefined",
    JSON.stringify(rows[0])
  );
}

// ---------------------------------------------------------------- main

async function main() {
  try {
    await caseA_dashboardStats();
    await caseB_userSearch();
    await caseC_banUnban();
    await caseD_softDeleteBlocksEscrow();
    await caseE_walletAdjustOwnership();
    await caseF_chatLogReason();
    await caseG_chatLogRetention();
    await caseH_settingsOwnership();
    await caseI_tokenPackPrice();
    await caseJ_auditLogViewer();
  } catch (error) {
    console.error("Test runner error:", error);
    process.exit(1);
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll admin panel tests passed.");
}

main();
