/**
 * Post-call money flow tests — `npm run test:post-call-money`.
 *
 * Covers the spec's done-when criteria:
 *   A. Immediate commission math: 10% of 500 = seller 450, owner 50.
 *   B. Release idempotency (sweep-safe).
 *   C. Release is immediate even when the call just ended.
 *   D. Release blocked when status is not 'completed'.
 *   E. Open dispute freezes escrow (release returns frozen_dispute).
 *   F. Resolve dispute → refund_buyer (100% to buyer).
 *   G. Resolve dispute → release_seller (commission deducted).
 *   H. Resolve dispute → split (50/50 with commission on seller's slice).
 *   I. Payout request min enforcement.
 *   J. Payout request balance check (over available).
 *   K. Payout full path: request → approve → mark_paid (ledger debit
 *      exactly once); replay mark_paid is no-op.
 *   L. Payout reject path: no ledger movement.
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

async function makeApprovedSeller(prefix) {
  const { email, password, userId } = await createUser(prefix);
  const support = await createUser(`${prefix}-support`);
  await grantRole(support.userId, "support");
  const supportClient = await signInAs(support.email, support.password);
  const client = await signInAs(email, password);
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
    .eq("user_id", userId)
    .maybeSingle();
  if (!appRow) throw new Error("application not visible");
  await supportClient.rpc("approve_seller_application", {
    _application_id: appRow.id,
    _note: null,
  });
  const { data: sp } = await admin
    .from("seller_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return { email, password, userId, sellerProfileId: sp.id, client };
}

async function makeBuyer(prefix) {
  const { email, password, userId } = await createUser(prefix);
  const client = await signInAs(email, password);
  return { email, password, userId, client };
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

async function assertAudit(actionPattern, targetId, label) {
  const { data: rows, error } = await admin
    .from("audit_log")
    .select("id, action, actor_id, target_id, details, created_at")
    .eq("target_id", targetId)
    .ilike("action", actionPattern)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) { check(label, false, `query error: ${error.message}`); return; }
  check(label, Array.isArray(rows) && rows.length >= 1, JSON.stringify(rows));
}

async function makeApprovedListing(sellerProfileId, priceTokens, durationMinutes) {
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .eq("slug", "companionship")
    .maybeSingle();
  const { data: listing, error } = await admin
    .from("listings")
    .insert({
      seller_id: sellerProfileId,
      category_id: cat?.id ?? null,
      title: `Test listing ${Date.now().toString(36)}`,
      description: "A friendly chat for the test suite.",
      price_tokens: priceTokens,
      duration_minutes: durationMinutes,
      status: "approved",
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !listing) throw error ?? new Error("listing insert failed");
  return listing.id;
}

async function addSlot(listingId, priceTokens, durationMinutes, startsAtOffsetMin) {
  const startsAt = new Date(Date.now() + startsAtOffsetMin * 60_000).toISOString();
  const endsAt = new Date(
    Date.now() + (startsAtOffsetMin + durationMinutes) * 60_000
  ).toISOString();
  const { data, error } = await admin
    .from("availability_slots")
    .insert({
      listing_id: listingId,
      starts_at: startsAt,
      ends_at: endsAt,
      price_tokens: priceTokens,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("slot insert failed");
  return data.id;
}

async function purchaseSlotAs(client, slotId) {
  return client.rpc("purchase_slot", { _slot_id: slotId });
}

/**
 * Forces a booking into "completed" state with a back-dated
 * live_ended_at and the seller having joined (so the no-show refund
 * path is satisfied). Returns the bookingId.
 */
async function createCompletedBooking({
  seller,
  buyer,
  priceTokens = 500,
  durationMinutes = 30,
  slotOffsetMin = 4,
  liveEndedMinutesAgo = null,
  leaveLive = false,
}) {
  await creditWallet(buyer.userId, priceTokens * 2);
  const listingId = await makeApprovedListing(seller.sellerProfileId, priceTokens, durationMinutes);
  const slotId = await addSlot(listingId, priceTokens, durationMinutes, slotOffsetMin);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  if (!purchase.data?.ok) throw new Error(`purchase failed: ${JSON.stringify(purchase.data)}`);
  const bookingId = purchase.data.booking_id;
  const ended = new Date(
    Date.now() - (liveEndedMinutesAgo ?? 60) * 60_000
  ).toISOString();
  await admin
    .from("bookings")
    .update({
      status: leaveLive ? "live" : "completed",
      live_ended_at: leaveLive ? null : ended,
      live_started_at: new Date(
        Date.now() - ((liveEndedMinutesAgo ?? 60) + 1) * 60_000
      ).toISOString(),
      seller_joined_at: new Date(
        Date.now() - ((liveEndedMinutesAgo ?? 60) + 1) * 60_000
      ).toISOString(),
      buyer_joined_at: new Date(
        Date.now() - ((liveEndedMinutesAgo ?? 60) + 1) * 60_000
      ).toISOString(),
    })
    .eq("id", bookingId);
  return { bookingId, slotId };
}

async function walletBalance(userId) {
  const r = await admin.rpc("wallet_get_balance", { _user_id: userId });
  return r.data;
}

// ---------------------------------------------------------------- cases

async function caseA_releaseMath() {
  console.log("\n== Case A: immediate release math (10% commission) ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    priceTokens: 500,
    durationMinutes: 30,
    slotOffsetMin: 4,
    liveEndedMinutesAgo: 30 * 60, // 30h ago — past the 24h window
  });

  const { data: ownerRows } = await admin.from("user_roles").select("user_id").eq("role", "owner").order("created_at").limit(1);
  const ownerId = ownerRows?.[0]?.user_id;
  const ownerEntries = await admin.from("ledger_entries").select("amount").eq("ref_id", bookingId).eq("ref_type", "platform_commission");
  const res = await admin.rpc("release_escrow", { _booking_id: bookingId });
  const data = res.data ?? {};
  check("A.1 release already completed", data.ok === true && data.already_released === true, JSON.stringify(data));
  check(
    "A.2 seller ledger credit = 450",
    (await admin.from("ledger_entries").select("amount").eq("ref_id", bookingId).eq("ref_type", "booking_release")).data?.[0]?.amount === 450
  );
  await assertAudit("%release%", bookingId, "A.2.audit release audit row exists");
  check(
    "A.3 owner role exists",
    Boolean(ownerId)
  );
  check(
    "A.4 owner commission ledger = 50",
    ownerEntries.data?.length === 1 && ownerEntries.data[0].amount === 50
  );

  check(
    "A.5 seller wallet contains immediate 450 credit",
    (await walletBalance(seller.userId)) >= 450
  );

  const { data: b } = await admin
    .from("bookings")
    .select("status, released_at")
    .eq("id", bookingId)
    .maybeSingle();
  check("A.6 booking status = released", b.status === "released", b.status);
  check("A.7 released_at populated", typeof b.released_at === "string");

  return { seller, buyer, bookingId };
}

async function caseB_releaseIdempotent() {
  console.log("\n== Case B: release idempotency ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    liveEndedMinutesAgo: 30 * 60,
  });

  const first = await admin.rpc("release_escrow", { _booking_id: bookingId });
  check("B.1 first release ok", first.data?.ok === true, JSON.stringify(first.data));
  const balanceAfterFirst = await walletBalance(seller.userId);

  // Replay the sweep.
  const second = await admin.rpc("release_escrow", { _booking_id: bookingId });
  check("B.2 second release ok (idempotent)", second.data?.ok === true);
  check(
    "B.3 second release already_released flag",
    second.data?.already_released === true,
    JSON.stringify(second.data)
  );

  const balanceAfterSecond = await walletBalance(seller.userId);
  check(
    "B.4 seller balance unchanged on replay",
    balanceAfterFirst === balanceAfterSecond,
    `${balanceAfterFirst} vs ${balanceAfterSecond}`
  );
}

async function caseC_releaseTooEarly() {
  console.log("\n== Case C: immediate release without a window ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    liveEndedMinutesAgo: 2 * 60,
  });
  const res = await admin.rpc("release_escrow", { _booking_id: bookingId });
  check(
    "C.1 already released",
    res.data?.already_released === true,
    JSON.stringify(res.data)
  );
  check(
    "C.2 no release window",
    !res.data?.releasable_at
  );
}

async function caseD_releaseWrongState() {
  console.log("\n== Case D: release blocked when status is not completed ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    leaveLive: true,
  });
  const res = await admin.rpc("release_escrow", { _booking_id: bookingId });
  check(
    "D.1 wrong_state when live",
    res.data?.code === "wrong_state",
    JSON.stringify(res.data)
  );
}

async function caseE_disputeFreezesEscrow() {
  console.log("\n== Case E: open dispute freezes escrow ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    leaveLive: true,
  });
  const open = await buyer.client.rpc("open_dispute", {
    _booking_id: bookingId,
    _reason: "Seller was unresponsive during the call and refused to engage.",
  });
  check("E.1 open_dispute ok", open.data?.ok === true, JSON.stringify(open.data));
  check("E.2 dispute_id returned", typeof open.data?.dispute_id === "string");

  // Try to release — must be frozen.
  const release = await admin.rpc("release_escrow", { _booking_id: bookingId });
  check(
    "E.3 release blocked: frozen_dispute",
    release.data?.code === "frozen_dispute",
    JSON.stringify(release.data)
  );

  const { data: b } = await admin
    .from("bookings")
    .select("status, dispute_opened_at")
    .eq("id", bookingId)
    .maybeSingle();
  check("E.4 booking status = disputed", b.status === "disputed", b.status);
  check("E.5 dispute_opened_at populated", typeof b.dispute_opened_at === "string");

  return { seller, buyer, bookingId };
}

async function caseF_resolveRefund() {
  console.log("\n== Case F: resolve_dispute → refund_buyer ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    priceTokens: 500,
    leaveLive: true,
  });
  const open = await buyer.client.rpc("open_dispute", {
    _booking_id: bookingId,
    _reason: "The video never connected and seller didn't troubleshoot.",
  });
  check("F.0 dispute opened", open.data?.ok === true);

  const finance = await makeUserWithRole("finance");
  const finClient = await signInAs(finance.email, finance.password);
  const beforeBuyer = await walletBalance(buyer.userId);
  const beforeSeller = await walletBalance(seller.userId);

  const res = await finClient.rpc("resolve_dispute", {
    _booking_id: bookingId,
    _outcome: "refund_buyer",
    _note: "Connectivity failure on seller side — full refund to buyer.",
  });
  check("F.1 resolve ok", res.data?.ok === true, JSON.stringify(res.data));
  await assertAudit("%dispute%", bookingId, "F.1.audit dispute audit row exists");
  check("F.2 buyer_credit = 500", res.data?.buyer_credit === 500);
  check("F.3 seller_credit = 0", res.data?.seller_credit === 0);

  const afterBuyer = await walletBalance(buyer.userId);
  const afterSeller = await walletBalance(seller.userId);
  check(
    "F.4 buyer wallet +500",
    afterBuyer - beforeBuyer === 500,
    `${beforeBuyer} → ${afterBuyer}`
  );
  check(
    "F.5 seller wallet unchanged",
    afterSeller === beforeSeller,
    `${beforeSeller} → ${afterSeller}`
  );

  const { data: b } = await admin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();
  check("F.6 booking released", b.status === "released");
}

async function caseG_resolveRelease() {
  console.log("\n== Case G: resolve_dispute → release_seller ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    priceTokens: 1000,
    leaveLive: true,
  });
  const open = await buyer.client.rpc("open_dispute", {
    _booking_id: bookingId,
    _reason: "Buyer opened the dispute in error; the call was fine.",
  });
  check("G.0 dispute opened", open.data?.ok === true);

  const finance = await makeUserWithRole("finance");
  const finClient = await signInAs(finance.email, finance.password);
  const beforeSeller = await walletBalance(seller.userId);

  const res = await finClient.rpc("resolve_dispute", {
    _booking_id: bookingId,
    _outcome: "release_seller",
    _note: "Dispute was unfounded; release to seller with standard commission.",
  });
  check("G.1 resolve ok", res.data?.ok === true);
  await assertAudit("%dispute%", bookingId, "G.1.audit dispute audit row exists");
  check(
    "G.2 seller_credit = 900 (1000 * 0.9)",
    res.data?.seller_credit === 900,
    `got=${res.data?.seller_credit}`
  );
  check("G.3 buyer_credit = 0", res.data?.buyer_credit === 0);

  const afterSeller = await walletBalance(seller.userId);
  check(
    "G.4 seller wallet +900",
    afterSeller - beforeSeller === 900,
    `${beforeSeller} → ${afterSeller}`
  );
}

async function caseH_resolveSplit() {
  console.log("\n== Case H: resolve_dispute → split (50/50) ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  const buyer = await makeBuyer("pcm-test-buyer");
  const { bookingId } = await createCompletedBooking({
    seller,
    buyer,
    priceTokens: 1000,
    leaveLive: true,
  });
  const open = await buyer.client.rpc("open_dispute", {
    _booking_id: bookingId,
    _reason: "Both parties had audio issues — request 50/50 split.",
  });
  check("H.0 dispute opened", open.data?.ok === true);

  const finance = await makeUserWithRole("finance");
  const finClient = await signInAs(finance.email, finance.password);
  const beforeBuyer = await walletBalance(buyer.userId);
  const beforeSeller = await walletBalance(seller.userId);

  const res = await finClient.rpc("resolve_dispute", {
    _booking_id: bookingId,
    _outcome: "split",
    _note: "Audio problems on both ends — fair split.",
    _refund_pct: 50,
  });
  check("H.1 resolve ok", res.data?.ok === true);
  await assertAudit("%dispute%", bookingId, "H.1.audit dispute audit row exists");
  check("H.2 buyer_credit = 500 (50% of 1000)", res.data?.buyer_credit === 500);
  check(
    "H.3 seller_credit = 450 (50% * 1000 * 0.9)",
    res.data?.seller_credit === 450,
    `got=${res.data?.seller_credit}`
  );

  const afterBuyer = await walletBalance(buyer.userId);
  const afterSeller = await walletBalance(seller.userId);
  check(
    "H.4 buyer +500",
    afterBuyer - beforeBuyer === 500,
    `${beforeBuyer} → ${afterBuyer}`
  );
  check(
    "H.5 seller +450",
    afterSeller - beforeSeller === 450,
    `${beforeSeller} → ${afterSeller}`
  );
}

async function caseI_payoutMin() {
  console.log("\n== Case I: payout request min enforcement ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  await creditWallet(seller.userId, 5000);

  const below = await seller.client.rpc("request_payout", { _amount: 500 });
  check(
    "I.1 below_min code",
    below.data?.code === "below_min",
    JSON.stringify(below.data)
  );
  check(
    "I.2 min returned is 1000 (default)",
    below.data?.min === 1000,
    `got=${below.data?.min}`
  );

  const ok = await seller.client.rpc("request_payout", { _amount: 1000 });
  check("I.3 exactly-min ok", ok.data?.ok === true, JSON.stringify(ok.data));

  return { seller };
}

async function caseJ_payoutBalance() {
  console.log("\n== Case J: payout balance check ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  await creditWallet(seller.userId, 2000);
  const a = await seller.client.rpc("request_payout", { _amount: 2000 });
  check("J.0 setup: first payout ok", a.data?.ok === true);

  const b = await seller.client.rpc("request_payout", { _amount: 1000 });
  check(
    "J.1 second payout over available: INSUFFICIENT_AVAILABLE",
    b.data?.code === "INSUFFICIENT_AVAILABLE",
    JSON.stringify(b.data)
  );
  check("J.2 have = 0", b.data?.have === 0, `got=${b.data?.have}`);
  check("J.3 need = 1000", b.data?.need === 1000, `got=${b.data?.need}`);
}

async function caseK_payoutFullPath() {
  console.log("\n== Case K: payout request → approve → mark_paid ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  await creditWallet(seller.userId, 5000);
  const req = await seller.client.rpc("request_payout", { _amount: 2000 });
  const payoutId = req.data?.payout_id;
  check("K.0 request ok", req.data?.ok === true);
  check("K.1 payout_id returned", typeof payoutId === "string");

  const finance = await makeUserWithRole("finance");
  const finClient = await signInAs(finance.email, finance.password);

  const approve = await finClient.rpc("approve_payout", { _id: payoutId });
  check("K.2 approve ok", approve.data?.ok === true);

  const beforeSeller = await walletBalance(seller.userId);
  const paid = await finClient.rpc("mark_payout_paid", {
    _id: payoutId,
    _payment_reference: "BANK-TXN-12345",
  });
  check("K.3 mark_paid ok", paid.data?.ok === true);
  await assertAudit("%payout%", payoutId, "K.3.audit payout audit row exists");
  check(
    "K.4 payment_reference returned",
    paid.data?.payment_reference === "BANK-TXN-12345"
  );

  const afterSeller = await walletBalance(seller.userId);
  check(
    "K.5 seller debited -2000",
    beforeSeller - afterSeller === 2000,
    `${beforeSeller} → ${afterSeller}`
  );

  // Replay mark_paid — must be idempotent.
  const replay = await finClient.rpc("mark_payout_paid", {
    _id: payoutId,
    _payment_reference: "BANK-TXN-12345",
  });
  check("K.6 replay ok", replay.data?.ok === true);
  check("K.7 already_paid flag", replay.data?.already_paid === true);
  const afterReplay = await walletBalance(seller.userId);
  check(
    "K.8 seller balance unchanged on replay",
    afterSeller === afterReplay,
    `${afterSeller} vs ${afterReplay}`
  );

  // Only one ledger debit row.
  const { data: debits } = await admin
    .from("ledger_entries")
    .select("id")
    .eq("ref_type", "payout")
    .eq("ref_id", payoutId);
  check(
    "K.9 exactly one payout debit row",
    debits?.length === 1,
    `got=${debits?.length}`
  );
}

async function caseL_payoutReject() {
  console.log("\n== Case L: payout reject ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  await creditWallet(seller.userId, 3000);
  const req = await seller.client.rpc("request_payout", { _amount: 1500 });
  const payoutId = req.data?.payout_id;
  check("L.0 setup ok", req.data?.ok === true);

  const finance = await makeUserWithRole("finance");
  const finClient = await signInAs(finance.email, finance.password);

  const beforeSeller = await walletBalance(seller.userId);
  const reject = await finClient.rpc("reject_payout", {
    _id: payoutId,
    _note: "Suspicious activity — please verify identity first.",
  });
  check("L.1 reject ok", reject.data?.ok === true);

  const afterSeller = await walletBalance(seller.userId);
  check(
    "L.2 seller balance unchanged",
    afterSeller === beforeSeller,
    `${beforeSeller} vs ${afterSeller}`
  );

  const { data: p } = await admin
    .from("payout_requests")
    .select("status, note")
    .eq("id", payoutId)
    .maybeSingle();
  check("L.3 payout status = rejected", p.status === "rejected");
  check("L.4 note recorded", typeof p.note === "string" && p.note.length > 0);
}

async function caseM_approvedPayoutReserved() {
  console.log("\n== Case M: approved_payout is reserved ==");
  const seller = await makeApprovedSeller("pcm-test-seller");
  await creditWallet(seller.userId, 3000);

  const before = await admin.rpc("get_seller_wallet_summary", { _user_id: seller.userId });
  const availBefore = before.data?.available;
  check("M.0 available = 3000", availBefore === 3000, `got=${availBefore}`);

  const req = await seller.client.rpc("request_payout", { _amount: 2000 });
  check("M.1 first request ok", req.data?.ok === true, JSON.stringify(req.data));

  const finance = await makeUserWithRole("finance");
  const finClient = await signInAs(finance.email, finance.password);
  const approve = await finClient.rpc("approve_payout", { _id: req.data.payout_id });
  check("M.2 approve ok", approve.data?.ok === true, JSON.stringify(approve.data));

  const after = await admin.rpc("get_seller_wallet_summary", { _user_id: seller.userId });
  check(
    "M.3 available dropped by 2000",
    availBefore - after.data?.available === 2000,
    `${availBefore} → ${after.data?.available}`
  );

  const second = await seller.client.rpc("request_payout", { _amount: 1500 });
  check(
    "M.4 second request rejected INSUFFICIENT_AVAILABLE",
    second.data?.code === "INSUFFICIENT_AVAILABLE",
    JSON.stringify(second.data)
  );
}

// ---------------------------------------------------------------- helpers

async function makeUserWithRole(role) {
  const { email, password, userId } = await createUser(`pcm-test-${role}`);
  await grantRole(userId, role);
  return { email, password, userId };
}

// ---------------------------------------------------------------- main

async function main() {
  try {
    await caseA_releaseMath();
    await caseB_releaseIdempotent();
    await caseC_releaseTooEarly();
    await caseD_releaseWrongState();
    await caseE_disputeFreezesEscrow();
    await caseF_resolveRefund();
    await caseG_resolveRelease();
    await caseH_resolveSplit();
    await caseI_payoutMin();
    await caseJ_payoutBalance();
    await caseK_payoutFullPath();
    await caseL_payoutReject();
    await caseM_approvedPayoutReserved();
  } catch (error) {
    console.error("Test runner error:", error);
    process.exit(1);
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll post-call money tests passed.");
}

main();
