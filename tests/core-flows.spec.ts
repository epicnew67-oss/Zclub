import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { safeRedirectPath } from "../src/lib/safe-redirect";
import { applyNotification, type NotificationRow } from "../src/lib/notification-state";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
if (!["localhost", "127.0.0.1"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)) throw new Error("Browser fixtures must use local Supabase");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function result<T extends { data: unknown; error: unknown }>(query: PromiseLike<T>): Promise<NonNullable<T["data"]>> { const { data, error } = await query; if (error) throw error; if (!data) throw new Error("Missing fixture data"); return data as NonNullable<T["data"]>; }
const stamp = randomUUID().slice(0, 8);
const password = `Regression-${randomUUID()}`;
let buyer: Session;
let seller: Session;
let listingId: string;
let slotId: string;
let callBookingId: string;
let callChatId: string;
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
  const s = await user("seller"); const b = await user(); seller = s.session; buyer = b.session;
  const profile = await result(admin.from("seller_profiles").insert({ user_id: seller.user.id, slug: `regression-${stamp}`, display_name: "Regression Seller" }).select("id").single());
  const cat = await result(admin.from("categories").select("id").eq("is_active", true).limit(1).single());
  const listing = await result(admin.from("listings").insert({ seller_id: profile.id, category_id: cat.id, title: "Regression Call", description: "Local end to end regression fixture", price_tokens: 200, duration_minutes: 30, status: "approved", is_active: true }).select("id").single());
  listingId = listing.id;
  const start = Date.now() + 48 * 60 * 60 * 1000;
  slotStart = new Date(start).toISOString();
  const slot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: slotStart, ends_at: new Date(start + 30 * 60 * 1000).toISOString(), price_tokens: 350, status: "open" }).select("id").single()); slotId = slot.id;
  const callStart = Date.now() + 2 * 60 * 1000;
  const callSlot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: new Date(callStart).toISOString(), ends_at: new Date(callStart + 30 * 60 * 1000).toISOString(), price_tokens: 200, status: "open" }).select("id").single());
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

test("joining an active call opens exactly one tab", async ({ page, context }) => {
  await authenticate(context, buyer);
  await page.goto(`/orders/${callBookingId}`);
  const pages: unknown[] = []; context.on("page", p => pages.push(p));
  await page.locator('[data-join-call="ready"]').click();
  await expect.poll(() => pages.length).toBe(1);
  await page.waitForTimeout(700);
  expect(pages).toHaveLength(1);
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

test.afterAll(async () => {
  // Preserve users, orders and ledger history; hide this test listing.
  if (listingId) await admin.from("listings").update({ is_active: false }).eq("id", listingId);
});
