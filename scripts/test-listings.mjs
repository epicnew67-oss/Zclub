/**
 * Automated listings tests — `npm run test:listings`.
 *
 * Verifies the listings workflow end-to-end against the local Supabase
 * stack:
 *   - Draft listing creation (status defaults to draft).
 *   - Submit for review requires title/desc/category/photo.
 *   - First seller doesn't self-publish; admin approval required.
 *   - Photo storage: owner-folder upload succeeds; foreign-folder upload
 *     is blocked by RLS.
 *   - Slot overlap rejection (10:00–10:30 blocks 10:15–10:45, allows
 *     10:30–11:00 and 09:00–10:00).
 *   - Slot remove when booked is blocked.
 *   - Non-admin cannot approve / reject / edit / unpublish
 *     (insufficient_privilege).
 *   - Admin approve -> status approved, audit_log (listing.approve) with
 *     diff, notification row, link /seller/listings.
 *   - Admin reject with <10-char reason blocked; ≥10-char reason ->
 *     status rejected, review_note, audit_log (listing.reject) with
 *     diff.
 *   - Admin edit while pending -> price change -> audit_log
 *     (listing.edit) with diff for price_tokens only.
 *   - Seller unpublish (own approved listing) -> status unpublished,
 *     audit_log (listing.unpublish).
 *   - Admin unpublish requires reason.
 *
 * Fixtures (listing-test-*@test.local, listings, photos, slots,
 * notifications, ledger/audit rows) are left in the local dev DB.
 * `npx supabase db reset` wipes them.
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

/** Approve a fresh seller so we get a seller_profile row to attach listings to. */
async function makeSeller(prefix, supportClient) {
  const user = await createUser(prefix);
  const termsVersion = (
    await admin.from("settings").select("value").eq("key", "seller_terms_version").maybeSingle()
  ).data?.value;
  const liveTermsVersion = termsVersion?.version ?? "v1";

  const client = await signInAs(user.email, user.password);
  const { error: submitErr } = await client.rpc("submit_seller_application", {
    _display_name: `${prefix}-display`,
    _gender: "female",
    _offering: `Friendly ${prefix} chats about books, movies, and life goals.`,
    _avatar_url: null,
    _terms_version: liveTermsVersion,
    _terms_ip: "127.0.0.1",
  });
  if (submitErr) throw submitErr;

  const { data: appRow } = await admin
    .from("seller_applications")
    .select("id")
    .eq("user_id", user.userId)
    .maybeSingle();
  if (!appRow) throw new Error("Application row not found after submit.");

  const { error: approveErr } = await supportClient.rpc("approve_seller_application", {
    _application_id: appRow.id,
    _note: "ok",
  });
  if (approveErr) throw approveErr;

  const { data: profileRow } = await admin
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.userId)
    .maybeSingle();
  if (!profileRow) throw new Error("seller_profile not found after approve.");
  return { user, client, sellerProfileId: profileRow.id };
}

async function firstCategoryId() {
  const { data } = await admin
    .from("categories")
    .select("id")
    .eq("is_active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No seeded categories; run base migration first.");
  return data.id;
}

// ---------------------------------------------------------------- 1. happy path

const support = await createUser("listing-test-support");
await grantRole(support.userId, "support");
const supportClient = await signInAs(support.email, support.password);

const seller = await makeSeller("listing-test-seller", supportClient);
const { data: initialListings } = await admin
  .from("listings")
  .select("id")
  .eq("seller_id", seller.sellerProfileId);
check("seller starts with zero listings", (initialListings ?? []).length === 0);

const categoryId = await firstCategoryId();

const { data: draft, error: draftErr } = await admin
  .from("listings")
  .insert({
    seller_id: seller.sellerProfileId,
    category_id: categoryId,
    title: "Book chats",
    description: "Friendly one-on-one chats about books and life.",
    price_tokens: 250,
    duration_minutes: 30,
    is_active: false,
  })
  .select("id, status")
  .single();
check("draft listing inserted", !draftErr, draftErr?.message);
check("draft listing status is draft", draft?.status === "draft");

// Update draft via admin client (the RPC is owner-only).
const { error: updateErr } = await admin
  .from("listings")
  .update({
    description: "Friendly one-on-one chats about books, movies, and life goals.",
    price_tokens: 300,
  })
  .eq("id", draft.id);
check("draft listing can be updated", !updateErr, updateErr?.message);

// ---------------------------------------------------------------- 2. submit requires photo + category

// Submit without a photo -> blocked.
const { data: noPhotoResult, error: noPhotoErr } = await seller.client.rpc(
  "submit_listing_for_review",
  { _listing_id: draft.id }
);
check("submit without photo is blocked", Boolean(noPhotoErr));
check(
  "blocked reason mentions photo",
  /photo/i.test(noPhotoErr?.message ?? "")
);

// Insert a photo row directly (we'll cover storage separately below).
const { data: photoRow, error: photoErr } = await admin
  .from("listing_photos")
  .insert({
    listing_id: draft.id,
    path: `${seller.user.userId}/${draft.id}/test-photo.jpg`,
    sort_order: 0,
  })
  .select("id")
  .single();
check("photo row inserted", !photoErr, photoErr?.message);

// Submit with photo -> pending_review.
const { data: submitOk, error: submitErr } = await seller.client.rpc(
  "submit_listing_for_review",
  { _listing_id: draft.id }
);
check("submit succeeds with photo + category", !submitErr, submitErr?.message);

const { data: pendingRow } = await admin
  .from("listings")
  .select("status, submitted_for_review_at")
  .eq("id", draft.id)
  .maybeSingle();
check("listing status is pending_review", pendingRow?.status === "pending_review");
check(
  "listing has submitted_for_review_at",
  Boolean(pendingRow?.submitted_for_review_at)
);

// ---------------------------------------------------------------- 3. role gate

const buyer = await createUser("listing-test-buyer");
const buyerClient = await signInAs(buyer.email, buyer.password);

const { error: buyerApproveErr } = await buyerClient.rpc("approve_listing", {
  _listing_id: draft.id,
  _note: null,
});
check("non-admin cannot approve", Boolean(buyerApproveErr));

const { error: buyerRejectErr } = await buyerClient.rpc("reject_listing", {
  _listing_id: draft.id,
  _reason: "no good reason why you said no",
});
check("non-admin cannot reject", Boolean(buyerRejectErr));

const { error: buyerEditErr } = await buyerClient.rpc("edit_listing", {
  _listing_id: draft.id,
  _patch: { price_tokens: 999 },
});
check("non-admin cannot edit", Boolean(buyerEditErr));

// ---------------------------------------------------------------- 4. support user approves

// (support user already created above; reuse supportClient.)

const { error: approveErr } = await supportClient.rpc("approve_listing", {
  _listing_id: draft.id,
  _note: "Looks great",
});
check("support user approves", !approveErr, approveErr?.message);

const { data: approvedRow } = await admin
  .from("listings")
  .select("status, is_active, reviewed_by, reviewed_at")
  .eq("id", draft.id)
  .maybeSingle();
check("status is approved", approvedRow?.status === "approved");
check("approval activates seller-created listing", approvedRow?.is_active === true);
check(
  "reviewed_by is the support user",
  approvedRow?.reviewed_by === support.userId
);
check("reviewed_at set", Boolean(approvedRow?.reviewed_at));

const { count: approveAudit } = await admin
  .from("audit_log")
  .select("id", { count: "exact", head: true })
  .eq("action", "listing.approve")
  .eq("target_id", draft.id);
check("audit_log has one listing.approve row", approveAudit === 1);

const { data: approveAuditRow } = await admin
  .from("audit_log")
  .select("details")
  .eq("action", "listing.approve")
  .eq("target_id", draft.id)
  .maybeSingle();
check(
  "approve audit_log has status diff",
  approveAuditRow?.details?.diff?.status?.before === "pending_review" &&
    approveAuditRow?.details?.diff?.status?.after === "approved"
);

const { data: approveNotif } = await admin
  .from("notifications")
  .select("id, title, link")
  .eq("user_id", seller.user.userId)
  .eq("type", "system")
  .ilike("title", "%Listing approved%")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
check("approval notification written", Boolean(approveNotif?.id));
check(
  "approval notification links to /seller/listings",
  approveNotif?.link === "/seller/listings"
);

// Re-approving a now-approved listing is blocked.
const { error: reApproveErr } = await supportClient.rpc("approve_listing", {
  _listing_id: draft.id,
  _note: null,
});
check("re-approving an approved listing is blocked", Boolean(reApproveErr));

// ---------------------------------------------------------------- 5. reject path (separate listing)

const { data: draft2, error: draft2Err } = await admin
  .from("listings")
  .insert({
    seller_id: seller.sellerProfileId,
    category_id: categoryId,
    title: "Movie chats",
    description: "Friendly chats about movies, directors, and hidden gems.",
    price_tokens: 200,
    duration_minutes: 30,
  })
  .select("id")
  .single();
check("second draft listing inserted", !draft2Err, draft2Err?.message);

await admin
  .from("listing_photos")
  .insert({ listing_id: draft2.id, path: `${seller.user.userId}/${draft2.id}/photo.jpg`, sort_order: 0 });

const { error: submit2Err } = await seller.client.rpc("submit_listing_for_review", {
  _listing_id: draft2.id,
});
check("submit second listing", !submit2Err, submit2Err?.message);

// Short reason -> blocked.
const { error: shortRejectErr } = await supportClient.rpc("reject_listing", {
  _listing_id: draft2.id,
  _reason: "too short",
});
check("reject with <10-char reason blocked", Boolean(shortRejectErr));

const longReason = "Description is too short to understand what buyers can expect.";
const { error: rejectErr } = await supportClient.rpc("reject_listing", {
  _listing_id: draft2.id,
  _reason: longReason,
});
check("reject with >=10-char reason succeeds", !rejectErr, rejectErr?.message);

const { data: rejectedRow } = await admin
  .from("listings")
  .select("status, review_note")
  .eq("id", draft2.id)
  .maybeSingle();
check("status is rejected", rejectedRow?.status === "rejected");
check("review_note matches", rejectedRow?.review_note === longReason);

const { count: rejectAudit } = await admin
  .from("audit_log")
  .select("id", { count: "exact", head: true })
  .eq("action", "listing.reject")
  .eq("target_id", draft2.id);
check("audit_log has one listing.reject row", rejectAudit === 1);

const { data: rejectAuditRow } = await admin
  .from("audit_log")
  .select("details")
  .eq("action", "listing.reject")
  .eq("target_id", draft2.id)
  .maybeSingle();
check(
  "reject audit_log has status diff",
  rejectAuditRow?.details?.diff?.status?.before === "pending_review" &&
    rejectAuditRow?.details?.diff?.status?.after === "rejected"
);

// ---------------------------------------------------------------- 6. edit (price diff only)

const { data: draft3, error: draft3Err } = await admin
  .from("listings")
  .insert({
    seller_id: seller.sellerProfileId,
    category_id: categoryId,
    title: "Travel chats",
    description: "Friendly chats about travel and food from around the world.",
    price_tokens: 400,
    duration_minutes: 30,
  })
  .select("id, price_tokens")
  .single();
check("third draft listing inserted", !draft3Err, draft3Err?.message);
const beforePrice = draft3.price_tokens;

await admin
  .from("listing_photos")
  .insert({
    listing_id: draft3.id,
    path: `${seller.user.userId}/${draft3.id}/photo.jpg`,
    sort_order: 0,
  });
await seller.client.rpc("submit_listing_for_review", { _listing_id: draft3.id });

const { error: editErr } = await supportClient.rpc("edit_listing", {
  _listing_id: draft3.id,
  _patch: { price_tokens: beforePrice + 50 },
});
check("support edits price", !editErr, editErr?.message);

const { data: editAuditRow } = await admin
  .from("audit_log")
  .select("details")
  .eq("action", "listing.edit")
  .eq("target_id", draft3.id)
  .maybeSingle();
check(
  "edit audit_log has price_tokens diff",
  editAuditRow?.details?.diff?.price_tokens?.before === beforePrice &&
    editAuditRow?.details?.diff?.price_tokens?.after === beforePrice + 50
);
check(
  "edit audit_log has ONLY price_tokens in diff",
  Object.keys(editAuditRow?.details?.diff ?? {}).length === 1
);

// ---------------------------------------------------------------- 7. slot overlap + ownership

// We use draft (now approved) for slot tests.
const slot1Start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const slot1End = new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();

const { data: slot1, error: slot1Err } = await seller.client.rpc("add_listing_slot", {
  _listing_id: draft.id,
  _starts_at: slot1Start,
  _ends_at: slot1End,
  _price_tokens: 300,
});
check("slot added", !slot1Err, slot1Err?.message);

const overlapStart = new Date(Date.now() + 24 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString();
const overlapEnd = new Date(Date.now() + 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();
const { error: overlapErr } = await seller.client.rpc("add_listing_slot", {
  _listing_id: draft.id,
  _starts_at: overlapStart,
  _ends_at: overlapEnd,
  _price_tokens: 300,
});
check("overlapping slot is rejected", Boolean(overlapErr));
check(
  "overlap reason mentions overlap",
  /overlap/i.test(overlapErr?.message ?? "")
);

const afterStart = new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
const afterEnd = new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString();
const { error: afterErr } = await seller.client.rpc("add_listing_slot", {
  _listing_id: draft.id,
  _starts_at: afterStart,
  _ends_at: afterEnd,
  _price_tokens: 300,
});
check("touching (end==start) slot is allowed", !afterErr, afterErr?.message);

const beforeStart = new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString();
const beforeEnd = new Date(Date.now() + 22 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
const { error: beforeErr } = await seller.client.rpc("add_listing_slot", {
  _listing_id: draft.id,
  _starts_at: beforeStart,
  _ends_at: beforeEnd,
  _price_tokens: 300,
});
check("preceding slot is allowed", !beforeErr, beforeErr?.message);

// Capture the `after` slot id so we can use it for the open-remove test
// (slot1 gets marked as booked below).
const { data: afterRows } = await admin
  .from("availability_slots")
  .select("id")
  .eq("listing_id", draft.id)
  .eq("status", "open")
  .order("starts_at", { ascending: true });
const afterSlotId = afterRows?.[0]?.id;

// Duration mismatch: 60-min slot on a 30-min listing -> blocked.
const wrongDurStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
const wrongDurEnd = new Date(Date.now() + 48 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString();
const { error: wrongDurErr } = await seller.client.rpc("add_listing_slot", {
  _listing_id: draft.id,
  _starts_at: wrongDurStart,
  _ends_at: wrongDurEnd,
  _price_tokens: 300,
});
check("duration mismatch is rejected", Boolean(wrongDurErr));

// A different seller can't add slots to this listing.
const other = await makeSeller("listing-test-other", supportClient);
const { error: otherAddErr } = await other.client.rpc("add_listing_slot", {
  _listing_id: draft.id,
  _starts_at: wrongDurStart,
  _ends_at: wrongDurEnd,
  _price_tokens: 300,
});
check("non-owner cannot add slot", Boolean(otherAddErr));

// Mark slot1 as booked then attempt remove -> blocked.
const slot1Id = slot1?.slot_id ?? slot1?.id;
await admin
  .from("availability_slots")
  .update({ status: "booked" })
  .eq("id", slot1Id);
const { error: removeBookedErr } = await seller.client.rpc("remove_listing_slot", {
  _slot_id: slot1Id,
});
check("removing a booked slot is blocked", Boolean(removeBookedErr));

// Owner can remove an open slot (use `after`, which is still open).
const { error: removeOpenErr } = await seller.client.rpc("remove_listing_slot", {
  _slot_id: afterSlotId,
});
check("removing an open slot succeeds", !removeOpenErr, removeOpenErr?.message);

// ---------------------------------------------------------------- 8. unpublish (seller path)

const pausedSlotId = randomUUID();
const { error: pausedSlotErr } = await admin.from("availability_slots").insert({
  id: pausedSlotId, listing_id: draft.id,
  starts_at: new Date(Date.now() + 84 * 60 * 60 * 1000).toISOString(),
  ends_at: new Date(Date.now() + 84.5 * 60 * 60 * 1000).toISOString(),
  price_tokens: 300, status: "open",
});
check("pause test has an open slot", !pausedSlotErr, pausedSlotErr?.message);
const { error: pauseErr } = await seller.client.rpc("set_own_listing_active", { _listing_id: draft.id, _active: false });
check("seller can pause an approved listing", !pauseErr, pauseErr?.message);
const { data: pausedRow } = await admin.from("listings").select("is_active").eq("id", draft.id).single();
check("paused listing is inactive", pausedRow?.is_active === false);
const { error: otherActivateErr } = await other.client.rpc("set_own_listing_active", { _listing_id: draft.id, _active: true });
check("another seller cannot activate the listing", Boolean(otherActivateErr));
const { error: pauseBuyerCreditErr } = await admin.rpc("wallet_credit", {
  _user_id: buyer.userId, _amount: 300, _entry_type: "support_adjustment",
  _ref_type: "test_fixture", _ref_id: randomUUID(), _description: "Paused listing test", _created_by: null,
});
check("buyer has enough tokens to exercise paused-slot guard", !pauseBuyerCreditErr, pauseBuyerCreditErr?.message);
const { data: pausedPurchase, error: pausedPurchaseErr } = await buyerClient.rpc("purchase_slot", { _slot_id: pausedSlotId });
check("known slot ID cannot book a paused listing", pausedPurchase?.code === "listing_unavailable" || pausedPurchaseErr?.message?.includes("listing_unavailable"), JSON.stringify({ pausedPurchase, pausedPurchaseErr }));
const { error: activateErr } = await seller.client.rpc("set_own_listing_active", { _listing_id: draft.id, _active: true });
check("seller can reactivate an approved listing", !activateErr, activateErr?.message);
const { data: activeRow } = await admin.from("listings").select("is_active").eq("id", draft.id).single();
check("reactivated listing is active", activeRow?.is_active === true);

const { error: sellerUnpubErr } = await seller.client.rpc("unpublish_listing", {
  _listing_id: draft.id,
  _reason: null,
});
check("seller unpublishes own approved listing", !sellerUnpubErr, sellerUnpubErr?.message);

const { data: unpublishedRow } = await admin
  .from("listings")
  .select("status")
  .eq("id", draft.id)
  .maybeSingle();
check("status is unpublished", unpublishedRow?.status === "unpublished");

const { data: unpubAudit } = await admin
  .from("audit_log")
  .select("id, details")
  .eq("action", "listing.unpublish")
  .eq("target_id", draft.id)
  .maybeSingle();
check("seller unpublish audit_log row exists", Boolean(unpubAudit?.id));
check(
  "seller unpublish audit_log has status diff",
  unpubAudit?.details?.diff?.status?.before === "approved" &&
    unpubAudit?.details?.diff?.status?.after === "unpublished"
);

// ---------------------------------------------------------------- 9. admin unpublish requires reason

// Approve draft3 again so we have a fresh approved listing.
await admin
  .from("listings")
  .update({ status: "draft", submitted_for_review_at: null })
  .eq("id", draft3.id);
await seller.client.rpc("submit_listing_for_review", { _listing_id: draft3.id });
await supportClient.rpc("approve_listing", { _listing_id: draft3.id, _note: null });

const { error: adminNoReasonErr } = await supportClient.rpc("unpublish_listing", {
  _listing_id: draft3.id,
  _reason: null,
});
check("admin unpublish without reason blocked", Boolean(adminNoReasonErr));

const { error: adminShortReasonErr } = await supportClient.rpc("unpublish_listing", {
  _listing_id: draft3.id,
  _reason: "x",
});
check("admin unpublish accepts a one-letter reason", !adminShortReasonErr, adminShortReasonErr?.message);

const adminReason = "Taken down for policy review by support team today.";
const { error: adminUnpubErr } = await supportClient.rpc("unpublish_listing", {
  _listing_id: draft3.id,
  _reason: adminReason,
});
check("repeated admin unpublish is harmless", !adminUnpubErr, adminUnpubErr?.message);

const { data: draft3After } = await admin
  .from("listings")
  .select("status, unpublished_reason")
  .eq("id", draft3.id)
  .maybeSingle();
check("status is unpublished", draft3After?.status === "unpublished");
check("one-letter unpublished reason recorded", draft3After?.unpublished_reason === "x");

// ---------------------------------------------------------------- 10. seller archive (soft delete)

const { error: otherArchiveErr } = await other.client.rpc("archive_own_listing", { _listing_id: draft.id });
check("another seller cannot delete this listing", Boolean(otherArchiveErr));
const archiveSlotId = randomUUID();
await admin.from("availability_slots").insert({
  id: archiveSlotId, listing_id: draft.id,
  starts_at: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
  ends_at: new Date(Date.now() + 96.5 * 60 * 60 * 1000).toISOString(),
  price_tokens: 300, status: "open",
});
const { error: archiveErr } = await seller.client.rpc("archive_own_listing", { _listing_id: draft.id });
check("seller deletes own listing", !archiveErr, archiveErr?.message);
const { data: archived } = await admin.from("listings").select("status,is_active,soft_deleted_at").eq("id", draft.id).single();
check("deleted listing is soft deleted and inactive", archived?.status === "unpublished" && archived?.is_active === false && Boolean(archived?.soft_deleted_at));
const { data: archivedSlot } = await admin.from("availability_slots").select("status").eq("id", archiveSlotId).single();
check("deleting listing blocks its unbooked slot", archivedSlot?.status === "blocked");
const { data: retainedSlot } = await admin.from("availability_slots").select("status").eq("id", slot1Id).single();
check("deleting listing keeps booked slot", retainedSlot?.status === "booked");
const { data: archiveAudit } = await admin.from("audit_log").select("id").eq("target_id", draft.id).eq("action", "listing.archive").maybeSingle();
check("listing deletion writes audit row", Boolean(archiveAudit?.id));

// ---------------------------------------------------------------- 11. storage RLS

const { error: ownUploadErr } = await seller.client.storage
  .from("listing-photos")
  .upload(`${seller.user.userId}/rls-test/photo.jpg`, new Uint8Array([1, 2, 3, 4]), {
    contentType: "image/jpeg",
  });
check("owner can upload to own folder", !ownUploadErr, ownUploadErr?.message);

const { error: foreignUploadErr } = await seller.client.storage
  .from("listing-photos")
  .upload(`someone-else/rls-test/photo.jpg`, new Uint8Array([1, 2, 3, 4]), {
    contentType: "image/jpeg",
  });
check("foreign-folder upload blocked", Boolean(foreignUploadErr));

// ---------------------------------------------------------------- 12. hostile browser writes

const { error: selfUnbanErr } = await seller.client.from("profiles")
  .update({ is_banned: false }).eq("id", seller.user.userId);
check("seller cannot change their own ban flag", Boolean(selfUnbanErr));
const { error: selfVerifyErr } = await seller.client.from("seller_profiles")
  .update({ is_verified: true }).eq("user_id", seller.user.userId);
check("seller cannot verify their own profile", Boolean(selfVerifyErr));
const { error: selfApproveErr } = await seller.client.from("listings")
  .insert({ seller_id: seller.sellerProfileId, category_id: categoryId,
    title: "Unreviewed listing", description: "Trying to bypass the review queue",
    price_tokens: 1, duration_minutes: 30, status: "approved", is_active: true });
check("browser cannot publish an unreviewed listing", Boolean(selfApproveErr));
const { data: approvedProbe } = await admin.from("listings")
  .insert({ seller_id: seller.sellerProfileId, category_id: categoryId,
    title: "Approved security probe", description: "A live listing for permission testing",
    price_tokens: 250, duration_minutes: 30, status: "approved", is_active: true })
  .select("id").single();
const { error: alterLiveErr } = await seller.client.from("listings")
  .update({ price_tokens: 1 }).eq("id", approvedProbe.id);
const { data: liveAfterAttempt } = await admin.from("listings")
  .select("price_tokens").eq("id", approvedProbe.id).single();
check("browser cannot change a live listing's price", Boolean(alterLiveErr) || liveAfterAttempt.price_tokens === 250);
const { data: ownWallet } = await admin.from("wallets")
  .select("id").eq("user_id", seller.user.userId).single();
const { data: balanceBeforeAttack } = await admin.rpc("wallet_get_balance", {
  _user_id: seller.user.userId,
});
const { error: forgedCreditErr } = await seller.client.from("ledger_entries")
  .insert({ wallet_id: ownWallet.id, entry_type: "topup", amount: 100000,
    ref_type: "payment", ref_id: randomUUID() });
check("browser cannot insert a token credit", Boolean(forgedCreditErr));
const { error: creditRpcErr } = await seller.client.rpc("wallet_credit", {
  _user_id: seller.user.userId, _amount: 100000, _entry_type: "topup",
  _ref_type: "payment", _ref_id: randomUUID(), _description: "forged", _created_by: null,
});
check("browser cannot call the wallet credit RPC", Boolean(creditRpcErr));
const { error: forgedTopupErr } = await seller.client.from("topup_requests")
  .insert({ user_id: seller.user.userId, method: "crypto", status: "approved", tokens: 100000 });
check("browser cannot create an approved top-up", Boolean(forgedTopupErr));
const { error: forgedPaymentErr } = await seller.client.from("payments")
  .insert({ user_id: seller.user.userId, status: "finished", tokens: 100000, price_pkr: 1 });
check("browser cannot forge a finished payment", Boolean(forgedPaymentErr));
const { error: webhookRpcErr } = await seller.client.rpc("nowpayments_webhook_apply", {
  _payment_id: randomUUID(), _payment_status: "finished", _pay_amount: 1,
});
check("browser cannot call the payment webhook RPC", Boolean(webhookRpcErr));
const { error: adminAdjustErr } = await seller.client.rpc("admin_wallet_adjust", {
  _user_id: seller.user.userId, _amount: 100000, _reason: "forged",
});
check("browser cannot use admin wallet adjustment", Boolean(adminAdjustErr));
const { error: escrowRpcErr } = await seller.client.rpc("release_escrow", { _booking_id: randomUUID() });
check("browser cannot call the escrow release RPC", Boolean(escrowRpcErr));
const { error: summaryRpcErr } = await seller.client.rpc("get_seller_wallet_summary", { _user_id: support.userId });
check("browser cannot read another user's wallet summary", Boolean(summaryRpcErr));
const { error: notifyRpcErr } = await seller.client.rpc("notify_role", {
  _roles: ["owner"], _type: "system", _title: "Forged alert", _body: "Pay me", _link: "/wallet",
});
check("browser cannot send trusted admin alerts", Boolean(notifyRpcErr));
const { data: privateSettings } = await seller.client.from("settings")
  .select("key").eq("key", "settlement_cutover");
check("browser cannot read private settlement settings", privateSettings?.length === 0);
const { data: balanceAfterAttack } = await admin.rpc("wallet_get_balance", {
  _user_id: seller.user.userId,
});
check("hostile requests do not change token balance", balanceBeforeAttack === balanceAfterAttack);

const { data: safeDraft, error: safeDraftErr } = await seller.client.from("listings")
  .insert({ seller_id: seller.sellerProfileId, category_id: categoryId,
    title: "Safe draft", description: "A normal seller draft for review",
    price_tokens: 250, duration_minutes: 30, status: "draft", is_active: false })
  .select("id").single();
check("seller can still save a normal draft", !safeDraftErr && Boolean(safeDraft?.id), safeDraftErr?.message);
const { error: safeEditErr } = await seller.client.from("listings")
  .update({ title: "Safe draft edited" }).eq("id", safeDraft?.id);
check("seller can still edit their draft", !safeEditErr, safeEditErr?.message);

// ---------------------------------------------------------------- done

console.log(
  `\nFixtures left in dev DB: ${seller.user.email}, ${buyer.email}, ${support.email}, ${other.user.email}`
);
if (failures > 0) {
  console.error(`\n${failures} listing test(s) FAILED`);
  process.exit(1);
}
console.log("All listing tests passed.");
