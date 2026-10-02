/**
 * Automated LiveKit / call tests — `npm run test:livekit`.
 *
 * Verifies the RPC contracts that gate the call flow:
 *   1. mint_livekit_token rejected when now < slot.starts_at - 5 min
 *      (too_early).
 *   2. mint_livekit_token rejected when now > slot.ends_at (too_late).
 *   3. mint_livekit_token rejected for a non-participant authed user
 *      (not_participant).
 *   4. mint_livekit_token rejected when booking.status is cancelled or
 *      seller_no_show (wrong_state).
 *   5. livekit_webhook_apply is idempotent: replaying participant_joined
 *      does not transition status twice and does not overwrite the first
 *      joined_at; room_finished is idempotent.
 *
 * The actual token mint + JWT signing requires the LiveKit API secret
 * (env-only) and is exercised at request time. The RPC tests below
 * confirm the gating logic so the server route never hands a caller
 * outside the window.
 */

import { readFileSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";
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
  await supportClient.rpc("approve_seller_application", { _application_id: appRow.id, _note: null });
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

async function mintTokenAs(client, bookingId) {
  return client.rpc("mint_livekit_token", { _booking_id: bookingId });
}

async function webhookApply(bookingId, eventType, userId, at) {
  return admin.rpc("livekit_webhook_apply", {
    _booking_id: bookingId,
    _event_type: eventType,
    _user_id: userId,
    _at: at,
  });
}

// ---------------------------------------------------------------- cases

async function case1_tooEarly() {
  console.log("\n== Case 1: token request before join window ==");
  const seller = await makeApprovedSeller("livekit-test-seller");
  const buyer = await makeBuyer("livekit-test-buyer");
  await creditWallet(buyer.userId, 1000);

  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  // Slot starts in 60 minutes — well outside the 5-minute pre-join window.
  const slotId = await addSlot(listingId, 500, 30, 60);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("1.0 setup: purchase ok", purchase.data?.ok === true, JSON.stringify(purchase.data));

  const res = await mintTokenAs(buyer.client, bookingId);
  const data = res.data ?? {};
  check(
    "1.1 buyer token request before window: too_early",
    data.code === "too_early",
    JSON.stringify(data)
  );
  check(
    "1.2 opens_at returned",
    typeof data.opens_at === "string",
    `opens_at=${data.opens_at}`
  );
}

async function case2_tooLate() {
  console.log("\n== Case 2: token request after window ==");
  const seller = await makeApprovedSeller("livekit-test-seller");
  const buyer = await makeBuyer("livekit-test-buyer");
  await creditWallet(buyer.userId, 1000);

  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  // Slot starts in 4 min (window open now) so purchase_slot accepts the
  // booking, then we back-date ends_at to simulate "call window over."
  const slotId = await addSlot(listingId, 500, 30, 4);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("2.0 setup: purchase ok (window open)", purchase.data?.ok === true, JSON.stringify(purchase.data));

  // Move slot into the past so the join window has passed.
  // Must move both ends_at AND starts_at — the table check requires
  // ends_at > starts_at.
  const { error: updateErr } = await admin
    .from("availability_slots")
    .update({
      starts_at: new Date(Date.now() - 120 * 60_000).toISOString(),
      ends_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    })
    .eq("id", slotId);
  check("2.0b setup: back-dated slot", !updateErr, updateErr?.message);

  const res = await mintTokenAs(buyer.client, bookingId);
  const data = res.data ?? {};
  check(
    "2.1 buyer token request after window: too_late",
    data.code === "too_late",
    JSON.stringify(data)
  );
}

async function case3_notParticipant() {
  console.log("\n== Case 3: token request from non-participant ==");
  const seller = await makeApprovedSeller("livekit-test-seller");
  const buyer = await makeBuyer("livekit-test-buyer");
  const intruder = await makeBuyer("livekit-test-intruder");
  await creditWallet(buyer.userId, 1000);

  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  // Slot is in the live join window (starts in 4 min, ends in 34 min).
  const slotId = await addSlot(listingId, 500, 30, 4);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("3.0 setup: purchase ok", purchase.data?.ok === true);

  const res = await mintTokenAs(intruder.client, bookingId);
  const data = res.data ?? {};
  check(
    "3.1 non-participant: not_participant",
    data.code === "not_participant",
    JSON.stringify(data)
  );
}

async function case4_wrongState() {
  console.log("\n== Case 4: token request when booking is finalized ==");
  const seller = await makeApprovedSeller("livekit-test-seller");
  const buyer = await makeBuyer("livekit-test-buyer");
  await creditWallet(buyer.userId, 1000);

  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  // Long-enough slot that the join window is still open when we cancel.
  const slotId = await addSlot(listingId, 500, 30, 4);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("4.0 setup: purchase ok", purchase.data?.ok === true);

  const cancel = await cancelBookingAs(buyer.client, bookingId);
  check("4.0b setup: cancel ok", cancel.data?.ok === true, JSON.stringify(cancel.data));

  const res = await mintTokenAs(buyer.client, bookingId);
  const data = res.data ?? {};
  check(
    "4.1 cancelled booking: wrong_state",
    data.code === "wrong_state" && data.status === "cancelled",
    JSON.stringify(data)
  );
}

async function case5_webhookIdempotency() {
  console.log("\n== Case 5: webhook idempotency ==");
  const seller = await makeApprovedSeller("livekit-test-seller");
  const buyer = await makeBuyer("livekit-test-buyer");
  await creditWallet(buyer.userId, 1000);

  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  const slotId = await addSlot(listingId, 500, 30, 4);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("5.0 setup: purchase ok", purchase.data?.ok === true);

  const firstJoin = new Date().toISOString();
  const first = await webhookApply(bookingId, "participant_joined", buyer.userId, firstJoin);
  check("5.1 first join ok", first.data?.ok === true, JSON.stringify(first.data));

  // Replay the same event with a later timestamp — joined_at must NOT
  // be overwritten (idempotent).
  const laterJoin = new Date(Date.now() + 5_000).toISOString();
  const replay = await webhookApply(bookingId, "participant_joined", buyer.userId, laterJoin);
  check("5.2 replay join ok", replay.data?.ok === true, JSON.stringify(replay.data));

  const { data: after } = await admin
    .from("bookings")
    .select("buyer_joined_at, status, live_started_at")
    .eq("id", bookingId)
    .maybeSingle();
  // Postgres returns ISO strings with "+00:00" suffix while JS's
  // Date.toISOString() uses "Z". Compare by parsed instant so the
  // string format doesn't trip an equivalent value.
  const gotJoinMs = after?.buyer_joined_at ? new Date(after.buyer_joined_at).getTime() : null;
  const wantJoinMs = new Date(firstJoin).getTime();
  check(
    "5.3 buyer_joined_at NOT overwritten on second event",
    gotJoinMs === wantJoinMs,
    `got=${after?.buyer_joined_at} (${gotJoinMs}) expected=${firstJoin} (${wantJoinMs})`
  );
  check(
    "5.4 booking status = live",
    after?.status === "live",
    `status=${after?.status}`
  );

  const sellerJoin = await webhookApply(bookingId, "participant_joined", seller.userId, new Date().toISOString());
  check("5.5 seller also joined", sellerJoin.data?.ok === true, JSON.stringify(sellerJoin.data));

  // room_finished: a call with the seller present transitions to completed.
  const finish = await webhookApply(bookingId, "room_finished", null, new Date().toISOString());
  check("5.6 room_finished ok", finish.data?.ok === true, JSON.stringify(finish.data));

  // Replay room_finished — must be idempotent (no error, no change).
  const replay2 = await webhookApply(bookingId, "room_finished", null, new Date().toISOString());
  check(
    "5.7 room_finished replay ok",
    replay2.data?.ok === true,
    JSON.stringify(replay2.data)
  );

  const { data: after2 } = await admin
    .from("bookings")
    .select("status, live_ended_at")
    .eq("id", bookingId)
    .maybeSingle();
  check(
    "5.8 booking still completed (no double transition)",
    after2?.status === "completed",
    `status=${after2?.status}`
  );

  // Unknown event: no-op, no error.
  const unknown = await webhookApply(bookingId, "track_published", buyer.userId, new Date().toISOString());
  check(
    "5.9 unknown event: unknown_event code",
    unknown.data?.code === "unknown_event",
    JSON.stringify(unknown.data)
  );

  // Unknown participant identity: rejected.
  const intruder = await webhookApply(
    bookingId,
    "participant_joined",
    "00000000-0000-0000-0000-000000000000",
    new Date().toISOString()
  );
  check(
    "5.10 finalized booking rejects a late join event",
    intruder.data?.code === "wrong_state",
    JSON.stringify(intruder.data)
  );
}

async function case6_buyerAloneGetsRefund() {
  console.log("\n== Case 6: buyer alone in call / seller no-show ==");
  const seller = await makeApprovedSeller("livekit-test-seller");
  const buyer = await makeBuyer("livekit-test-buyer");
  await creditWallet(buyer.userId, 1000);
  const listingId = await makeApprovedListing(seller.sellerProfileId, 500, 30);
  const slotId = await addSlot(listingId, 500, 30, 4);
  const purchase = await purchaseSlotAs(buyer.client, slotId);
  const bookingId = purchase.data?.booking_id;
  check("6.0 setup purchase", purchase.data?.ok === true);
  const joined = await webhookApply(bookingId, "participant_joined", buyer.userId, new Date().toISOString());
  check("6.1 buyer joined", joined.data?.ok === true);
  await webhookApply(bookingId, "room_finished", null, new Date().toISOString());
  const { data: afterLeave } = await admin.from("bookings").select("status").eq("id", bookingId).single();
  check("6.2 buyer-only call stays eligible for no-show refund", afterLeave?.status === "live", JSON.stringify(afterLeave));
  await admin.from("availability_slots").update({ starts_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq("id", slotId);
  const refunded = await admin.rpc("mark_no_show_refund", { _booking_id: bookingId });
  check("6.3 seller no-show refunds buyer", refunded.data?.ok === true, JSON.stringify(refunded.data));
  const { data: afterRefund } = await admin.from("bookings").select("status").eq("id", bookingId).single();
  check("6.4 booking is seller_no_show", afterRefund?.status === "seller_no_show");
  const lateJoin = await webhookApply(bookingId, "participant_joined", seller.userId, new Date().toISOString());
  check("6.5 late seller join cannot revive refunded booking", lateJoin.data?.code === "wrong_state", JSON.stringify(lateJoin.data));
}

// ---------------------------------------------------------------- main

async function main() {
  try {
    await case1_tooEarly();
    await case2_tooLate();
    await case3_notParticipant();
    await case4_wrongState();
    await case5_webhookIdempotency();
    await case6_buyerAloneGetsRefund();
  } catch (error) {
    console.error("Test runner error:", error);
    process.exit(1);
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll LiveKit tests passed.");
}

main();
