/**
 * Automated bookings tests — `npm run test:bookings`.
 *
 * Verifies the purchasing flow end-to-end against the local Supabase
 * stack:
 *   1. Insufficient balance: 100 tokens, 500-token slot → INSUFFICIENT_BALANCE
 *      with shortfall 400. Slot stays open; no booking; no chat.
 *   2. Successful purchase: 5,000 tokens → booking paid, chat created,
 *      slot booked, booking_hold -500, balance 4,500.
 *   3. Double-booking race: two concurrent purchase_slot on the same
 *      open slot → exactly one ok:true, the other slot_already_taken.
 *      One booking row, one booking_hold ledger row.
 *   4. Cancel >24h before, full refund: buyer cancels → balance restored,
 *      slot open, booking cancelled, ledger booking_refund +price,
 *      audit_log row.
 *   5. Cancel <24h before, partial refund: 50/50 split between buyer
 *      and seller (cancellation_policy = 50%).
 *   6. No-show refund: mark_no_show_refund on a stale booking → buyer
 *      refunded full, booking seller_no_show, both notified. Re-run is
 *      a no-op (idempotent).
 *   7. Chat messaging: buyer + seller send; non-participant blocked;
 *      rate-limit enforced; HTML sanitized server-side.
 *   8. Cancel too late: slot in the past → too_late. Second cancel on a
 *      finalized booking → already_finalized.
 *
 * Fixtures (booking-test-*@test.local, slots, bookings, chats,
 * messages, ledger/audit rows) are left in the local dev DB. Never
 * hard-delete anything.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

async function makeApprovedSeller(prefix) {
  const { email, password, userId } = await createUser(prefix);

  // Create a support user to approve the application.
  const support = await createUser(`${prefix}-support`);
  await grantRole(support.userId, "support");
  const supportClient = await signInAs(support.email, support.password);

  const termsVersion =
    (
      await admin
        .from("settings")
        .select("value")
        .eq("key", "seller_terms_version")
        .maybeSingle()
    )?.data?.value?.version ?? "v1";

  const client = await signInAs(email, password);
  const { error: submitErr } = await client.rpc("submit_seller_application", {
    _display_name: `${prefix}-display`,
    _gender: "female",
    _offering: `Friendly ${prefix} chats about books, movies, and life goals.`,
    _avatar_url: null,
    _terms_version: termsVersion,
    _terms_ip: "127.0.0.1",
  });
  if (submitErr) throw submitErr;

  const { data: appRow } = await admin
    .from("seller_applications")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!appRow) throw new Error("application not visible");

  const { error: approveErr } = await supportClient.rpc(
    "approve_seller_application",
    {
      _application_id: appRow.id,
      _note: null,
    }
  );
  if (approveErr) throw approveErr;

  const { data: sp } = await admin
    .from("seller_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!sp) throw new Error("seller_profiles row missing");
  return { email, password, userId, sellerProfileId: sp.id, client };
}

async function makeBuyer(prefix) {
  const { email, password, userId } = await createUser(prefix);
  const client = await signInAs(email, password);
  return { email, password, userId, client };
}

async function creditWallet(userId, amount, refType, refId) {
  const { error } = await admin.rpc("wallet_credit", {
    _user_id: userId,
    _amount: amount,
    _entry_type: "support_adjustment",
    _ref_type: refType,
    _ref_id: refId,
    _description: "test fixture",
    _created_by: null,
  });
  if (error) throw error;
}

async function getBalance(userId) {
  const { data } = await admin.rpc("wallet_get_balance", { _user_id: userId });
  return typeof data === "number" ? data : 0;
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

async function cancelBookingAs(client, bookingId) {
  return client.rpc("cancel_booking", { _booking_id: bookingId });
}

async function sendChatMessageAs(client, chatId, body) {
  return client.rpc("send_chat_message", { _chat_id: chatId, _body: body });
}

async function markNoShow(bookingId) {
  return admin.rpc("mark_no_show_refund", { _booking_id: bookingId });
}

async function approveListing(listingId) {
  const { error } = await admin
    .from("listings")
    .update({ status: "approved", is_active: true })
    .eq("id", listingId);
  if (error) throw error;
}

// ---------------------------------------------------------------- cases

async function case1_insufficientBalance() {
  console.log("\n== Case 1: insufficient balance ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  const refId = randomUUID();
  await creditWallet(buyer.userId, 100, "support", refId);
  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  const slotId = await addSlot(listingId, 500, 30, 60);

  const res = await purchaseSlotAs(buyer.client, slotId);
  const data = res.data ?? {};
  check(
    "1.1 INSUFFICIENT_BALANCE code",
    data.code === "INSUFFICIENT_BALANCE",
    JSON.stringify(data)
  );
  check("1.2 shortfall = 400", data.shortfall === 400, `shortfall=${data.shortfall}`);
  check("1.3 have = 100", data.have === 100, `have=${data.have}`);
  check("1.4 need = 500", data.need === 500, `need=${data.need}`);

  const { data: slot } = await admin
    .from("availability_slots")
    .select("status")
    .eq("id", slotId)
    .maybeSingle();
  check("1.5 slot still open", slot?.status === "open", `status=${slot?.status}`);

  const { count: bookingCount } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId);
  check("1.6 no booking created", bookingCount === 0, `count=${bookingCount}`);

  const balance = await getBalance(buyer.userId);
  check("1.7 balance untouched (100)", balance === 100, `balance=${balance}`);
}

async function case2_successfulPurchase() {
  console.log("\n== Case 2: successful purchase ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  const refId = randomUUID();
  await creditWallet(buyer.userId, 5000, "support", refId);
  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  const slotId = await addSlot(listingId, 500, 30, 60);

  const res = await purchaseSlotAs(buyer.client, slotId);
  const data = res.data ?? {};
  check("2.1 ok", data.ok === true, JSON.stringify(data));
  check("2.2 booking_id returned", !!data.booking_id);
  check("2.3 chat_id returned", !!data.chat_id);

  const { data: booking } = await admin
    .from("bookings")
    .select("status, price_tokens, buyer_id, seller_id")
    .eq("id", data.booking_id)
    .maybeSingle();
  check("2.4 booking.status = paid", booking?.status === "paid");
  check("2.5 booking.price_tokens = 500", booking?.price_tokens === 500);
  check(
    "2.6 buyer_id matches",
    booking?.buyer_id === buyer.userId,
    `got=${booking?.buyer_id}`
  );
  check(
    "2.7 seller_id matches",
    booking?.seller_id === seller.userId,
    `got=${booking?.seller_id}`
  );

  const { data: chat } = await admin
    .from("booking_chats")
    .select("id")
    .eq("booking_id", data.booking_id)
    .maybeSingle();
  check("2.8 chat row exists", !!chat && chat.id === data.chat_id);

  const { data: slot } = await admin
    .from("availability_slots")
    .select("status")
    .eq("id", slotId)
    .maybeSingle();
  check("2.9 slot now booked", slot?.status === "booked");

  const balance = await getBalance(buyer.userId);
  check("2.10 balance = 4500", balance === 4500, `balance=${balance}`);

  const { data: ledger } = await admin
    .from("ledger_entries")
    .select("amount, entry_type, ref_id")
    .eq("ref_id", data.booking_id);
  const hold = (ledger ?? []).find((l) => l.entry_type === "booking_hold");
  check("2.11 booking_hold ledger row = -500", hold?.amount === -500, `amount=${hold?.amount}`);

  return {
    buyer,
    seller,
    bookingId: data.booking_id,
    chatId: data.chat_id,
    listingId,
    slotId,
  };
}

async function case3_doubleBookingRace(ctx) {
  console.log("\n== Case 3: double-booking race ==");
  const buyer2 = await makeBuyer("booking-test-buyer2");
  const refId = randomUUID();
  await creditWallet(buyer2.userId, 5000, "support", refId);

  const listingId = await makeApprovedListing(ctx.seller.sellerProfileId, 500, 30);
  const slotId = await addSlot(listingId, 500, 30, 90);

  // Both buyers race on the same slot.
  const [a, b] = await Promise.all([
    purchaseSlotAs(ctx.buyer.client, slotId),
    purchaseSlotAs(buyer2.client, slotId),
  ]);
  const datas = [a.data ?? {}, b.data ?? {}];
  const wins = datas.filter((d) => d.ok === true);
  const losses = datas.filter((d) => d.ok === false);

  check("3.1 exactly one success", wins.length === 1, `wins=${wins.length}`);
  check("3.2 exactly one failure", losses.length === 1, `losses=${losses.length}`);
  check(
    "3.3 failure code = slot_already_taken",
    losses[0]?.code === "slot_already_taken",
    JSON.stringify(losses[0])
  );

  const { count } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slotId);
  check("3.4 exactly one booking row", count === 1, `count=${count}`);

  const winningBookingId = wins[0]?.booking_id;
  const { data: holds } = await admin
    .from("ledger_entries")
    .select("amount")
    .eq("entry_type", "booking_hold")
    .eq("ref_id", winningBookingId);
  check("3.5 exactly one booking_hold row", (holds ?? []).length === 1);

  // ---- Stress race: N independent races launched in parallel, each on
  // a distinct slot. Per-slot invariants verify the unique-constraint
  // catch holds at scale; cross-cutting invariants verify no slot ever
  // sees a double-booking and the ledger is debited exactly once per
  // successful purchase (no orphan debits from losing racers).
  console.log("\n== Case 3 (stress): N parallel races ==");
  const N = 5;
  const stressSeller = await makeApprovedSeller("booking-stress-seller");
  const stressBuyers = [];
  for (let i = 0; i < 2 * N; i += 1) {
    const b = await makeBuyer(`booking-stress-buyer-${i}`);
    await creditWallet(b.userId, 5000, "support", randomUUID());
    stressBuyers.push(b);
  }
  const stressListings = [];
  const stressSlots = [];
  for (let i = 0; i < N; i += 1) {
    const lid = await makeApprovedListing(stressSeller.sellerProfileId, 500, 30);
    const sid = await addSlot(lid, 500, 30, 60 + i);
    stressListings.push(lid);
    stressSlots.push(sid);
  }

  // Pair (buyer 2i, buyer 2i+1) on slot i. Fire all N races
  // simultaneously so PostgREST + Postgres see a thundering herd.
  const racePromises = stressSlots.map((slot, i) =>
    Promise.all([
      purchaseSlotAs(stressBuyers[i * 2].client, slot),
      purchaseSlotAs(stressBuyers[i * 2 + 1].client, slot),
    ])
  );
  const raceResults = await Promise.all(racePromises);

  const winningBookingIds = [];
  for (let i = 0; i < N; i += 1) {
    const [resA, resB] = raceResults[i];
    const dataA = resA.data ?? {};
    const dataB = resB.data ?? {};
    const slotWins = [dataA, dataB].filter((d) => d.ok === true);
    const slotLosses = [dataA, dataB].filter((d) => d.ok === false);

    check(
      `3.S${i}.1 exactly one winner on slot ${i}`,
      slotWins.length === 1,
      `wins=${slotWins.length} data=${JSON.stringify([dataA, dataB])}`
    );
    check(
      `3.S${i}.2 exactly one loser on slot ${i}`,
      slotLosses.length === 1,
      `losses=${slotLosses.length}`
    );
    check(
      `3.S${i}.3 loser code is slot_already_taken`,
      slotLosses[0]?.code === "slot_already_taken",
      JSON.stringify(slotLosses[0])
    );

    const { count: bookingCount } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("slot_id", stressSlots[i]);
    check(
      `3.S${i}.4 exactly one booking on slot ${i}`,
      bookingCount === 1,
      `count=${bookingCount}`
    );

    if (slotWins[0]?.booking_id) winningBookingIds.push(slotWins[0].booking_id);
  }

  // Cross-cutting: every stress slot has exactly one booking.
  const { data: allStressBookings } = await admin
    .from("bookings")
    .select("slot_id")
    .in("slot_id", stressSlots);
  const slotBookingCounts = {};
  for (const b of allStressBookings ?? []) {
    slotBookingCounts[b.slot_id] = (slotBookingCounts[b.slot_id] ?? 0) + 1;
  }
  const duplicateSlots = Object.entries(slotBookingCounts).filter(
    ([, c]) => c > 1
  );
  check(
    "3.STRESS.1 no stress slot has >1 booking",
    duplicateSlots.length === 0,
    `duplicates=${JSON.stringify(duplicateSlots)}`
  );

  // Cross-cutting: exactly one booking_hold ledger row per winning booking
  // (no double-debit from losing racers).
  const { count: holdCount, data: holdRows } = await admin
    .from("ledger_entries")
    .select("amount", { count: "exact" })
    .eq("entry_type", "booking_hold")
    .in("ref_id", winningBookingIds);
  check(
    "3.STRESS.2 exactly N booking_hold rows (one per winner)",
    holdCount === N && holdRows?.length === N,
    `holds=${holdCount} expected=${N}`
  );

  // Cross-cutting: total debit = -500 * N (no orphan debits anywhere).
  const totalDebit = (holdRows ?? []).reduce((sum, h) => sum + h.amount, 0);
  check(
    "3.STRESS.3 total debit = -500 * N (no orphan debits)",
    totalDebit === -500 * N,
    `total=${totalDebit} expected=${-500 * N}`
  );
}

async function case4_cancelFullRefund() {
  console.log("\n== Case 4: cancel >24h before, full refund ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  await creditWallet(buyer.userId, 500, "support", randomUUID());

  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  const slotId = await addSlot(listingId, 500, 30, 60 * 30); // 30h ahead
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  check("4.0 setup: purchase ok", purchase.data?.ok === true, JSON.stringify(purchase.data));
  const bookingId = purchase.data?.booking_id;

  const balanceAfterPurchase = await getBalance(buyer.userId);
  check("4.1 buyer debited to 0", balanceAfterPurchase === 0, `balance=${balanceAfterPurchase}`);

  const cancel = await cancelBookingAs(buyer.client, bookingId);
  const data = cancel.data ?? {};
  check("4.2 cancel ok", data.ok === true, JSON.stringify(data));
  check("4.3 refunded_buyer = 500", data.refunded_buyer === 500, `got=${data.refunded_buyer}`);
  check("4.4 released_seller = 0", data.released_seller === 0, `got=${data.released_seller}`);

  const balanceAfterCancel = await getBalance(buyer.userId);
  check(
    "4.5 balance restored to 500",
    balanceAfterCancel === 500,
    `balance=${balanceAfterCancel}`
  );

  const { data: booking } = await admin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();
  check("4.6 booking.status = cancelled", booking?.status === "cancelled");

  const { data: slot } = await admin
    .from("availability_slots")
    .select("status")
    .eq("id", slotId)
    .maybeSingle();
  check("4.7 slot reopened", slot?.status === "open");

  const { data: refunds } = await admin
    .from("ledger_entries")
    .select("amount")
    .eq("entry_type", "booking_refund")
    .eq("ref_id", bookingId);
  check("4.8 booking_refund ledger row = +500", refunds?.[0]?.amount === 500);

  const { data: audit } = await admin
    .from("audit_log")
    .select("action, details")
    .eq("target_id", bookingId)
    .eq("action", "booking.cancel")
    .maybeSingle();
  check("4.9 audit_log row exists", !!audit);
}

async function case5_cancelPartialRefund() {
  console.log("\n== Case 5: cancel <24h before, partial refund ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  await creditWallet(buyer.userId, 500, "support", randomUUID());

  const listingId = await makeApprovedListing(seller.sellerProfileId, 200, 30);
  const slotId = await addSlot(listingId, 200, 30, 60 * 6); // 6h ahead
  const res = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = res.data?.booking_id;
  check("5.0 setup: purchase ok", res.data?.ok === true, JSON.stringify(res.data));

  const buyerBefore = await getBalance(buyer.userId);
  const sellerBefore = await getBalance(seller.userId);

  const cancel = await cancelBookingAs(buyer.client, bookingId);
  const data = cancel.data ?? {};
  check("5.1 cancel ok", data.ok === true, JSON.stringify(data));
  check(
    "5.2 refunded_buyer = 100 (50% of 200)",
    data.refunded_buyer === 100,
    `got=${data.refunded_buyer}`
  );
  check(
    "5.3 released_seller = 100 (50% comp)",
    data.released_seller === 100,
    `got=${data.released_seller}`
  );

  const buyerAfter = await getBalance(buyer.userId);
  const sellerAfter = await getBalance(seller.userId);
  check(
    "5.4 buyer balance +100",
    buyerAfter - buyerBefore === 100,
    `diff=${buyerAfter - buyerBefore}`
  );
  check(
    "5.5 seller balance +100",
    sellerAfter - sellerBefore === 100,
    `diff=${sellerAfter - sellerBefore}`
  );
}

async function case6_noShowRefund() {
  console.log("\n== Case 6: no-show refund ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  await creditWallet(buyer.userId, 1000, "support", randomUUID());

  const listingId = await makeApprovedListing(seller.sellerProfileId, 800, 30);
  // 15 minutes ago — past the 10-minute grace.
  const slotId = await addSlot(listingId, 800, 30, -15);
  const res = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = res.data?.booking_id;
  check("6.0 purchase ok", res.data?.ok === true, JSON.stringify(res.data));

  const buyerBefore = await getBalance(buyer.userId);
  const first = await markNoShow(bookingId);
  const data = first.data ?? {};
  check("6.1 mark_no_show ok", data.ok === true, JSON.stringify(data));
  check("6.2 not a noop", !data.noop);

  const buyerAfter = await getBalance(buyer.userId);
  check("6.3 buyer refunded 800", buyerAfter - buyerBefore === 800, `diff=${buyerAfter - buyerBefore}`);

  const { data: booking } = await admin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();
  check("6.4 booking.status = seller_no_show", booking?.status === "seller_no_show");

  const { data: notifs } = await admin
    .from("notifications")
    .select("user_id")
    .eq("link", `/orders/${bookingId}`);
  const recipients = new Set((notifs ?? []).map((n) => n.user_id));
  check(
    "6.5 both parties notified",
    recipients.has(buyer.userId) && recipients.has(seller.userId),
    `recipients=${[...recipients].join(",")}`
  );

  // Idempotent re-run.
  const second = await markNoShow(bookingId);
  const data2 = second.data ?? {};
  check("6.6 rerun is no-op", data2.ok === true && data2.noop === true, JSON.stringify(data2));

  const { count: refundCount } = await admin
    .from("ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("entry_type", "booking_refund")
    .eq("ref_id", bookingId);
  check("6.7 only one booking_refund row", refundCount === 1, `count=${refundCount}`);
}

async function case7_chatMessaging() {
  console.log("\n== Case 7: chat messaging, rate limit, sanitization ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  const buyer2 = await makeBuyer("booking-test-buyer3");
  await creditWallet(buyer.userId, 500, "support", randomUUID());

  const listingId = await makeApprovedListing(seller.sellerProfileId, 200, 30);
  const slotId = await addSlot(listingId, 200, 30, 60);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const chatId = purchase.data?.chat_id;
  check("7.0 setup purchase ok", purchase.data?.ok === true);

  // Buyer and seller both send.
  const buyerMsg = await sendChatMessageAs(buyer.client, chatId, "Hello from buyer");
  check("7.1 buyer sends ok", buyerMsg.error == null, buyerMsg.error?.message);
  const sellerMsg = await sendChatMessageAs(seller.client, chatId, "Hi from seller");
  check("7.2 seller sends ok", sellerMsg.error == null, sellerMsg.error?.message);

  // Sanitization: HTML tags stripped server-side. Text between tags is
  // preserved; the JSX layer auto-escapes so the rendered output is
  // safe plain text either way.
  const evil = await sendChatMessageAs(buyer.client, chatId, "<script>alert(1)</script>hello");
  check("7.3 sanitization allowed send", evil.error == null, evil.error?.message);
  const { data: last } = await admin
    .from("booking_messages")
    .select("body")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  check(
    "7.4 HTML tags stripped (script tag removed)",
    last?.body === "alert(1)hello",
    `body="${last?.body}"`
  );

  // Non-participant rejected.
  const intruder = await sendChatMessageAs(buyer2.client, chatId, "let me in");
  check(
    "7.5 non-participant rejected",
    intruder.error != null,
    "expected error from non-participant"
  );

  // Rate limit: settings.max_per_minute = 20. We've already sent 3
  // (buyer+evil counted twice in the messages table). Send 18 more
  // from buyer → all OK. Then 1 more from buyer → rejected.
  let rateLimited = false;
  let sentCount = 0;
  for (let i = 0; i < 18; i++) {
    const r = await sendChatMessageAs(buyer.client, chatId, `msg ${i}`);
    if (r.error) {
      rateLimited = true;
      break;
    }
    sentCount += 1;
  }
  check(
    "7.6 sent up to rate cap (>=17)",
    sentCount >= 17 && !rateLimited,
    `sent=${sentCount} rateLimited=${rateLimited}`
  );

  const overflow = await sendChatMessageAs(buyer.client, chatId, "one too many");
  check(
    "7.7 21st message rate-limited",
    overflow.error != null,
    overflow.data?.toString?.() ?? "no error"
  );
}

async function case8_cancelEdgeCases() {
  console.log("\n== Case 8: cancel too late / idempotency ==");
  const seller = await makeApprovedSeller("booking-test-seller");
  const buyer = await makeBuyer("booking-test-buyer");
  await creditWallet(buyer.userId, 500, "support", randomUUID());

  const listingId = await makeApprovedListing(seller.sellerProfileId, 300, 30);
  // Slot started 5 minutes ago.
  const slotId = await addSlot(listingId, 300, 30, -5);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("8.0 purchase ok (slot in past, but ends_at > now)", purchase.data?.ok === true);

  const cancel = await cancelBookingAs(buyer.client, bookingId);
  const data = cancel.data ?? {};
  check("8.1 too_late (slot already started)", data.code === "too_late", JSON.stringify(data));

  // Idempotency on a finalized booking: cancel a fully cancelled one.
  const listing2 = await makeApprovedListing(seller.sellerProfileId, 300, 30);
  const slot2 = await addSlot(listing2, 300, 30, 60 * 30);
  await creditWallet(buyer.userId, 300, "support", randomUUID());
  const p2 = await purchaseSlotAs(buyer.client, slot2);
  const b2 = p2.data?.booking_id;
  await cancelBookingAs(buyer.client, b2); // first cancel succeeds
  const cancel2 = await cancelBookingAs(buyer.client, b2);
  const data2 = cancel2.data ?? {};
  check(
    "8.2 already_finalized on second cancel",
    data2.code === "already_finalized",
    JSON.stringify(data2)
  );
}

// ---------------------------------------------------------------- main

async function main() {
  try {
    await approveListing; // ensure reference to helper

    await case1_insufficientBalance();
    const ctx2 = await case2_successfulPurchase();
    await case3_doubleBookingRace(ctx2);
    await case4_cancelFullRefund();
    await case5_cancelPartialRefund();
    await case6_noShowRefund();
    await case7_chatMessaging();
    await case8_cancelEdgeCases();
  } catch (error) {
    console.error("Test runner error:", error);
    process.exit(1);
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll booking tests passed.");
}

main();
