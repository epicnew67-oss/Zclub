import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { safeRedirectPath } from "../src/lib/safe-redirect";
import { applyNotification, type NotificationRow } from "../src/lib/notification-state";
import { zonedWallTimeToUtc } from "../src/lib/time-zone";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
if (!["localhost", "127.0.0.1"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)) throw new Error("Browser fixtures must use local Supabase");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function result<T extends { data: unknown; error: unknown }>(query: PromiseLike<T>): Promise<NonNullable<T["data"]>> { const { data, error } = await query; if (error) throw error; if (!data) throw new Error("Missing fixture data"); return data as NonNullable<T["data"]>; }
const stamp = randomUUID().slice(0, 8);
const password = `Regression-${randomUUID()}`;
let buyer: Session;
let seller: Session;
let moderator: Session;
let listingId: string;
let slotId: string;
let callBookingId: string;
let callChatId: string;
let callStartIso: string;
let slotStart: string;
const slug = `regression-${stamp}--regression-call`;
async function authenticate(context: BrowserContext, session: Session) {
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://localhost:3000", sameSite: "Lax" }]);
}

test.beforeAll(async () => {
  async function user(role?: string) {
    const email = `regression-${role || "buyer"}-${stamp}@test.local`;
    const created = await result(admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Regression ${role || "Buyer"}` } }));
    if (!created.user) throw new Error("Fixture user was not created");
    if (role) { const { error } = await admin.from("user_roles").insert({ user_id: created.user.id, role }); if (error) throw error; }
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const session = await result(client.auth.signInWithPassword({ email, password }));
    return { session: session.session!, client };
  }
  const s = await user("seller"); const b = await user(); const m = await user("support"); seller = s.session; buyer = b.session; moderator = m.session;
  const profile = await result(admin.from("seller_profiles").insert({ user_id: seller.user.id, slug: `regression-${stamp}`, display_name: "Regression Seller" }).select("id").single());
  const cat = await result(admin.from("categories").select("id").eq("is_active", true).limit(1).single());
  const listing = await result(admin.from("listings").insert({ seller_id: profile.id, category_id: cat.id, title: "Regression Call", description: "Local end to end regression fixture", price_tokens: 200, duration_minutes: 30, status: "approved", is_active: true }).select("id").single());
  listingId = listing.id;
  const start = Date.now() + 48 * 60 * 60 * 1000;
  slotStart = new Date(start).toISOString();
  const slot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: slotStart, ends_at: new Date(start + 30 * 60 * 1000).toISOString(), price_tokens: 350, status: "open" }).select("id").single()); slotId = slot.id;
  const callStart = Date.now() + 2 * 60 * 1000;
  callStartIso = new Date(callStart).toISOString();
  const callSlot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: callStartIso, ends_at: new Date(callStart + 30 * 60 * 1000).toISOString(), price_tokens: 200, status: "open" }).select("id").single());
  await result(admin.rpc("wallet_credit", { _user_id: buyer.user.id, _amount: 2000, _entry_type: "support_adjustment", _ref_type: "test_fixture", _ref_id: randomUUID(), _description: "Browser regression", _created_by: null }));
  const purchase = await result(b.client.rpc("purchase_slot", { _slot_id: callSlot.id }));
  callBookingId = purchase.booking_id; callChatId = purchase.chat_id;
});

test("redirect targets stay on-site including backslashes and control characters", () => {
  for (const target of ["//evil.test", "/\\evil.test", "/\t/evil.test", "javascript:alert(1)", "https://evil.test", ["/orders"]]) expect(safeRedirectPath(target)).toBe("/account");
  expect(safeRedirectPath("/orders/123?slot=456")).toBe("/orders/123?slot=456");
  expect(safeRedirectPath("https://site.test/wallet#balance", "/wallet", "https://site.test")).toBe("/wallet#balance");
});

test("notification read echoes and duplicate insert events never double-count", () => {
  const row: NotificationRow = { id: "a", type: "booking_created", title: "Booking", body: null, link: null, read_at: null, created_at: "2026-10-02T00:00:00Z" };
  const initial = { rows: [row], unread: 5 };
  const read = { ...row, read_at: "2026-10-02T01:00:00Z" };
  const optimistic = applyNotification(initial, read);
  expect(optimistic.unread).toBe(4);
  expect(applyNotification(optimistic, read).unread).toBe(4);
  expect(applyNotification(initial, row, true).unread).toBe(5);
  expect(applyNotification(initial, { ...row, id: "b" }, true).unread).toBe(6);
});

test("regional wall times convert to UTC and DST gaps or overlaps are rejected", () => {
  expect(zonedWallTimeToUtc("2026-10-02T14:30", "Asia/Karachi")).toEqual({ iso: "2026-10-02T09:30:00.000Z" });
  expect(zonedWallTimeToUtc("2026-03-08T02:30", "America/Los_Angeles")).toHaveProperty("error");
  expect(zonedWallTimeToUtc("2026-11-01T01:30", "America/Los_Angeles")).toHaveProperty("error");
});

test("sign-up stores the selected region", async ({ page }) => {
  const email = `region-${stamp}@test.local`;
  await page.goto("/auth/sign-up");
  await page.getByLabel("Display name").fill(`Region ${stamp}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Your region / time zone").selectOption("Asia/Karachi");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/check-email/);
  await expect.poll(async () => {
    const { data } = await admin.from("profiles").select("time_zone").eq("display_name", `Region ${stamp}`).maybeSingle();
    return data?.time_zone;
  }).toBe("Asia/Karachi");
});

test("clearing search cancels the pending debounce", async ({ page }) => {
  await page.goto("/browse");
  await page.getByRole("searchbox", { name: "Search listings" }).fill("Regression");
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.waitForTimeout(800);
  await expect(page.getByRole("searchbox", { name: "Search listings" })).toHaveValue("");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("slot selection toggles instantly, shows the actual slot price, and hydrates across timezones", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/listings/${slug}?slot=${slotId}`);
  const selected = page.locator("[data-slots] button[aria-pressed=true]");
  await expect(selected).toHaveCount(1);
  await expect(page.locator("[data-buy-panel]").locator(".text-3xl")).toHaveText("350");
  await selected.click();
  await expect(page.locator("[data-slots] button[aria-pressed=true]")).toHaveCount(0);
  await expect(page.locator("[data-buy-panel]").locator(".text-3xl")).toHaveText("200");
  expect(errors).toEqual([]);
});

test("buyer can sign in, reserve a slot and see the order in their timezone", async ({ page }) => {
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(`/listings/${slug}?slot=${slotId}`)}`);
  await page.getByLabel("Email", { exact: true }).fill(buyer.user.email!);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reserve this slot" })).toBeVisible();
  await page.getByRole("button", { name: "Reserve this slot" }).click();
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Regression Call", exact: true })).toBeVisible();
  const expected = await page.evaluate(iso => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles", timeZoneName: "short" }).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), slotStart);
  await expect(page.locator("header time").first()).toHaveText(expected);
});

test("buyer can open the orders list and return to an order", async ({ page, context }) => {
  await authenticate(context, buyer);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: /Your orders/i })).toBeVisible();
  await expect(page.locator(`a[href="/orders/${callBookingId}"]`)).toBeVisible();
  await page.locator(`a[href="/orders/${callBookingId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${callBookingId}$`));
  expect(errors).toEqual([]);
});

test("buyer and seller see the same booking in their own time zones", async ({ browser }) => {
  const buyerContext = await browser.newContext({ baseURL: "http://localhost:3000", timezoneId: "Asia/Kolkata" });
  const sellerContext = await browser.newContext({ baseURL: "http://localhost:3000", timezoneId: "America/Los_Angeles" });
  try {
    await authenticate(buyerContext, buyer);
    await authenticate(sellerContext, seller);
    const buyerPage = await buyerContext.newPage();
    const sellerPage = await sellerContext.newPage();
    const errors: string[] = [];
    sellerPage.on("pageerror", error => errors.push(error.message));
    await buyerPage.goto("/orders");
    await sellerPage.goto("/seller/orders");
    const options = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" } as const;
    const expectedIndia = await buyerPage.evaluate(({ iso, options }) => new Date(iso).toLocaleString(undefined, options).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), { iso: callStartIso, options });
    const expectedLA = await sellerPage.evaluate(({ iso, options }) => new Date(iso).toLocaleString(undefined, options).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), { iso: callStartIso, options });
    await expect(buyerPage.locator(`a[href="/orders/${callBookingId}"] time`)).toHaveText(expectedIndia);
    await expect(sellerPage.locator(`a[href="/orders/${callBookingId}"] time`)).toHaveText(expectedLA);
    expect(expectedIndia).not.toBe(expectedLA);
    await sellerPage.goto("/seller/availability");
    await expect(sellerPage.getByText("Pick a listing, add slots in America/Los_Angeles")).toBeVisible();
    await expect(sellerPage.getByText("Showing slots for the selected listing in America/Los_Angeles")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await buyerContext.close();
    await sellerContext.close();
  }
});

test("joining an active call opens exactly one tab", async ({ page, context }) => {
  await authenticate(context, buyer);
  await page.goto(`/orders/${callBookingId}`);
  const pages: unknown[] = []; context.on("page", p => pages.push(p));
  await page.locator('[data-join-call="ready"]').click();
  await expect.poll(() => pages.length).toBe(1);
  await page.waitForTimeout(700);
  expect(pages).toHaveLength(1);
});

test("phone call chat opens as a bottom panel without replacing video or controls", async ({ page, context }) => {
  await authenticate(context, buyer);
  await context.grantPermissions(["camera", "microphone"]);
  await page.goto(`/call/${callBookingId}`);
  await page.getByTestId("pre-join").getByRole("button", { name: "Join call" }).click();
  await expect(page.getByTestId("call-page")).toHaveAttribute("data-call-connected", "true", { timeout: 20_000 });
  await expect.poll(async () => {
    const { data } = await admin.from("bookings").select("buyer_joined_at").eq("id", callBookingId).single();
    return data?.buyer_joined_at ?? null;
  }, { timeout: 20_000 }).not.toBeNull();
  const chatButton = page.getByRole("button", { name: "Open call chat" });
  await expect(chatButton).toBeVisible();
  await chatButton.click();
  const panel = page.getByRole("dialog", { name: "Call chat" });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("call-video-stage")).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThan(200);
  expect(box!.y + box!.height).toBeLessThan(844);
  await page.getByRole("button", { name: "Close call chat", exact: true }).last().click();
  await expect(panel).toHaveCount(0);
});

test("buyer and seller connect to the same call and completion is recorded", async ({ browser, page, context }) => {
  await authenticate(context, buyer);
  await context.grantPermissions(["camera", "microphone"]);
  const sellerContext = await browser.newContext({ baseURL: "http://localhost:3000", permissions: ["camera", "microphone"], viewport: { width: 390, height: 844 } });
  try {
    await authenticate(sellerContext, seller);
    const sellerPage = await sellerContext.newPage();
    await page.goto(`/call/${callBookingId}`);
    await sellerPage.goto(`/call/${callBookingId}`);
    await page.getByTestId("pre-join").getByRole("button", { name: "Join call" }).click();
    await sellerPage.getByTestId("pre-join").getByRole("button", { name: "Join call" }).click();
    await expect(page.getByTestId("call-page")).toHaveAttribute("data-call-connected", "true", { timeout: 20_000 });
    await expect(sellerPage.getByTestId("call-page")).toHaveAttribute("data-call-connected", "true", { timeout: 20_000 });
    await expect.poll(async () => {
      const { data } = await admin.from("bookings").select("buyer_joined_at,seller_joined_at,status").eq("id", callBookingId).single();
      return Boolean(data?.buyer_joined_at && data?.seller_joined_at && data?.status === "live");
    }, { timeout: 20_000 }).toBe(true);
    await page.locator(".lk-disconnect-button").click();
    await sellerPage.locator(".lk-disconnect-button").click();
    await expect.poll(async () => {
      const { data } = await admin.from("bookings").select("status").eq("id", callBookingId).single();
      return data?.status;
    }, { timeout: 20_000 }).toBe("completed");
  } finally {
    await sellerContext.close();
  }
});

test("buyer desktop navigation exposes orders and notifications show their contents", async ({ page, context }) => {
  await authenticate(context, buyer);
  await page.setViewportSize({ width: 1280, height: 800 });
  const note = await result(admin.from("notifications").insert({ user_id: buyer.user.id, type: "booking", title: "Call scheduled", body: "Your booked call is ready in My orders.", link: `/orders/${callBookingId}` }).select("id").single());
  await page.goto("/orders");
  await expect(page.locator("header nav").getByRole("link", { name: "My orders" })).toBeVisible();
  for (const width of [768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  const bell = page.getByRole("button", { name: /Notifications/ });
  await expect(bell).toHaveAttribute("aria-label", /unread/);
  await bell.click();
  await expect(page.getByRole("dialog", { name: "Notifications" }).getByText("Your booked call is ready in My orders.")).toBeVisible();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(bell).toHaveAttribute("aria-label", "Notifications");
  const { data } = await admin.from("notifications").select("read_at").eq("id", note.id).single();
  expect(data?.read_at).toBeTruthy();
});

test("seller sees new chat messages and booking status without reloading", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto(`/orders/${callBookingId}`);
  const text = `New message ${stamp}`;
  await admin.from("booking_messages").insert({ chat_id: callChatId, sender_id: buyer.user.id, body: text });
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await admin.from("bookings").update({ status: "released" }).eq("id", callBookingId);
  await expect(page.locator('[data-join-call="disabled"]')).toHaveText("Call ended");
});

test("released and disputed bookings cannot join even inside the time window", async ({ page, context }) => {
  await authenticate(context, buyer);
  for (const status of ["released", "disputed"]) {
    await admin.from("bookings").update({ status }).eq("id", callBookingId);
    await page.goto(`/orders/${callBookingId}`);
    await expect(page.locator('[data-join-call="disabled"]')).toBeDisabled();
    await expect(page.locator(`a[href="/call/${callBookingId}"]`)).toHaveCount(0);
  }
});

test("long chats show the latest 500 messages when reopened", async ({ page, context }) => {
  const start = Date.now() - 600_000;
  const { error } = await admin.from("booking_messages").insert(Array.from({ length: 501 }, (_, i) => ({ chat_id: callChatId, sender_id: buyer.user.id, body: `History ${stamp} ${i}`, created_at: new Date(start + i * 1000).toISOString() })));
  if (error) throw error;
  await authenticate(context, buyer);
  await page.goto(`/orders/${callBookingId}`);
  await expect(page.getByText(`History ${stamp} 500`, { exact: true })).toBeVisible();
  await expect(page.getByText(`History ${stamp} 0`, { exact: true })).toHaveCount(0);
});

test("seller can cancel an unstarted call after the slot begins and buyer is fully refunded", async ({ page, context }) => {
  const start = Date.now() + 60 * 60_000;
  const slot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 30 * 60_000).toISOString(), price_tokens: 200, status: "open" }).select("id").single());
  const booking = await result(createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${buyer.access_token}` } } }).rpc("purchase_slot", { _slot_id: slot.id }));
  await admin.from("availability_slots").update({ starts_at: new Date(Date.now() - 5 * 60_000).toISOString(), ends_at: new Date(Date.now() + 25 * 60_000).toISOString() }).eq("id", slot.id);
  await authenticate(context, seller);
  await page.goto(`/orders/${booking.booking_id}`);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  const { data } = await admin.from("bookings").select("status").eq("id", booking.booking_id).single();
  expect(data?.status).toBe("cancelled");
  const { data: refunds } = await admin.from("ledger_entries").select("amount").eq("ref_id", booking.booking_id).eq("entry_type", "booking_refund");
  expect(refunds?.reduce((sum, row) => sum + row.amount, 0)).toBe(200);
});

test("seller sees a booked slot become a running call", async ({ page, context }) => {
  const start = Date.now() + 72 * 60 * 60_000;
  const slot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 30 * 60_000).toISOString(), price_tokens: 200, status: "open" }).select("id").single());
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${buyer.access_token}` } } });
  const booking = await result(client.rpc("purchase_slot", { _slot_id: slot.id }));
  await authenticate(context, seller);
  await page.goto("/seller/availability");
  await page.getByRole("button", { name: /Notifications/ }).click();
  const notices = page.getByRole("dialog", { name: "Notifications" });
  await expect(notices.getByText("New video call booked").first()).toBeVisible();
  await expect(notices.getByText(/booked Regression Call for 200 tokens/).first()).toBeVisible();
  await expect(notices.getByRole("button", { name: "Booking sound on" })).toBeVisible();
  await notices.getByRole("button", { name: "Close notifications" }).click();
  const bookedRow = page.locator("li").filter({ has: page.locator(`a[href="/orders/${booking.booking_id}"]`) });
  await expect(bookedRow.getByRole("link", { name: "View booking" })).toBeVisible();
  await expect(bookedRow.locator('[data-slot="badge"]')).toHaveText("Slot booked");
  await expect(page.getByTestId("seller-booking-realtime")).toHaveAttribute("data-connected", "true");
  const { error } = await admin.from("bookings").update({ status: "live" }).eq("id", booking.booking_id);
  if (error) throw error;
  await expect(bookedRow.locator('[data-slot="badge"]')).toHaveText("Video call running");
  await page.goto("/seller/orders");
  await expect(page.locator(`a[href="/orders/${booking.booking_id}"]`).getByText("Video call running")).toBeVisible();
});

test("inactive listings are hidden from the public marketplace", async ({ page }) => {
  await page.goto("/browse");
  await expect(page.locator(`a[href="/listings/${slug}"]`)).toBeVisible();
  const { error } = await admin.from("listings").update({ is_active: false }).eq("id", listingId);
  if (error) throw error;
  await page.goto("/browse");
  await expect(page.locator(`a[href="/listings/${slug}"]`)).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator(`a[href="/listings/${slug}"]`)).toHaveCount(0);
  await page.goto(`/listings/${slug}`);
  await expect(page).toHaveTitle(/Listing not found/);
  await expect(page.getByRole("button", { name: /Buy|Book/ })).toHaveCount(0);
});

test("seller can activate and pause an approved listing", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/seller/listings");
  const listing = page.locator('[data-slot="card"]').filter({ hasText: "Regression Call" }).first();
  await expect(listing.getByText("Paused", { exact: true })).toBeVisible();
  await listing.getByRole("button", { name: "Activate listing" }).click();
  await expect(listing.getByRole("button", { name: "Pause listing" })).toBeVisible();
  const { data: active } = await admin.from("listings").select("is_active").eq("id", listingId).single();
  expect(active?.is_active).toBe(true);
  await listing.getByRole("button", { name: "Pause listing" }).click();
  await expect(listing.getByRole("button", { name: "Activate listing" })).toBeVisible();
});

test("seller availability uses the saved region rather than the device region", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/account");
  await page.getByLabel("Your time zone").selectOption("Asia/Karachi");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await expect(page.getByText("Time zone saved.")).toBeVisible();
  await page.goto("/seller/availability");
  await expect(page.getByText("Pick a listing, add slots in Asia/Karachi")).toBeVisible();
  await expect(page.getByText("Showing slots for the selected listing in Asia/Karachi")).toBeVisible();
  const expected = await page.evaluate(iso => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), callStartIso);
  await expect(page.locator("li").filter({ has: page.locator(`a[href="/orders/${callBookingId}"]`) })).toContainText(expected);
});

test("seller can delete a listing without losing booked orders", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/seller/listings");
  await page.getByRole("button", { name: "Delete listing" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Listing removed. Existing orders are still available.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete listing" })).toHaveCount(0);
  const { data } = await admin.from("listings").select("soft_deleted_at,is_active").eq("id", listingId).single();
  expect(data?.soft_deleted_at).toBeTruthy();
  expect(data?.is_active).toBe(false);
  await page.goto(`/orders/${callBookingId}`);
  await expect(page.getByRole("heading", { name: "Regression Call" })).toBeVisible();
});

test("admin sees only approved listings and can unpublish with one letter", async ({ page, context }) => {
  const { data: original } = await admin.from("listings").select("seller_id,category_id").eq("id", listingId).single();
  if (!original) throw new Error("Missing listing fixture");
  const base = { seller_id: original.seller_id, category_id: original.category_id, description: "Moderation regression fixture", price_tokens: 100, duration_minutes: 30 };
  const draft = await result(admin.from("listings").insert({ ...base, title: `Draft ${stamp}`, status: "draft", is_active: false }).select("id").single());
  const approved = await result(admin.from("listings").insert({ ...base, title: `Approved ${stamp}`, status: "approved", is_active: true, reviewed_at: new Date().toISOString() }).select("id").single());
  await authenticate(context, moderator);
  await page.goto("/admin/listings");
  await expect(page.getByRole("heading", { name: "Approved listings" })).toBeVisible();
  await expect(page.getByTestId(`admin-listing-${draft.id}`)).toHaveCount(0);
  const card = page.getByTestId(`admin-listing-${approved.id}`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Unpublish" }).click();
  const dialog = page.getByRole("dialog", { name: "Unpublish listing" });
  await dialog.getByRole("textbox", { name: "Reason" }).fill("x");
  await dialog.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByTestId(`admin-listing-${approved.id}`)).toHaveCount(0);
  const { data: row } = await admin.from("listings").select("status,is_active,unpublished_reason").eq("id", approved.id).single();
  expect(row).toMatchObject({ status: "unpublished", is_active: false, unpublished_reason: "x" });
});

test("saved region overrides device time zone on orders", async ({ page, context }) => {
  await authenticate(context, buyer);
  await page.goto("/account");
  await page.getByLabel("Your time zone").selectOption("Asia/Karachi");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await expect(page.getByText("Time zone saved.")).toBeVisible();
  await page.goto("/orders");
  const expected = await page.evaluate(iso => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi", timeZoneName: "short" }).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), callStartIso);
  await expect(page.locator(`a[href="/orders/${callBookingId}"] time`)).toHaveText(expected);
});

test.afterAll(async () => {
  // Preserve users, orders and ledger history; hide this test listing.
  if (listingId) await admin.from("listings").update({ is_active: false }).eq("id", listingId);
});
