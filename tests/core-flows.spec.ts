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

test("sign-up stores the selected region and profile photo", async ({ page }) => {
  const email = `region-${stamp}@test.local`;
  await page.goto("/auth/sign-up");
  await page.getByLabel("Display name").fill(`Region ${stamp}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Your region / time zone").selectOption("Asia/Karachi");
  await page.locator("#sign-up-photo").setInputFiles({
    name: "profile.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R7sAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/check-email/);
  const profile = await result(admin.from("profiles").select("id,time_zone").eq("display_name", `Region ${stamp}`).single());
  expect(profile.time_zone).toBe("Asia/Karachi");
  const { error: confirmError } = await admin.auth.admin.updateUserById(profile.id, { email_confirm: true });
  if (confirmError) throw confirmError;
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(async () => {
    const { data } = await admin.from("profiles").select("avatar_url").eq("id", profile.id).single();
    return data?.avatar_url;
  }).toMatch(new RegExp(`^${profile.id}/avatar-.*\\.png$`));
});

test("seller names lead to public profiles and searchable calls", async ({ page }) => {
  await page.goto(`/sellers/regression-${stamp}`);
  await expect(page.getByRole("heading", { name: "Regression Seller", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Regression Call by Regression Seller", exact: true })).toBeVisible();
  await page.goto("/browse?q=Regression%20Seller");
  await expect(page.locator(`a[href="/listings/${slug}"]`)).toBeVisible();
  await page.goto("/browse?q=%22%2C%28%29");
  await expect(page.getByRole("heading", { name: /Something went wrong/ })).toHaveCount(0);
});

test("clearing search cancels the pending debounce", async ({ page }) => {
  await page.goto("/browse");
  await page.getByRole("searchbox", { name: "Search listings" }).fill("Regression");
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.waitForTimeout(800);
  await expect(page.getByRole("searchbox", { name: "Search listings" })).toHaveValue("");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("listing shows one on-demand price without scheduled slots", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/listings/${slug}?slot=${slotId}`);
  await expect(page.locator("[data-slots]")).toHaveCount(0);
  await expect(page.locator("[data-buy-panel]")).toContainText("200");
  await expect(page.locator("[data-buy-panel]")).toContainText("Offline");
  expect(errors).toEqual([]);
});

test("seller category menu is readable and selection works", async ({ page }) => {
  await authenticate(page.context(), seller);
  await page.goto("/seller/listings/new");
  const category = page.getByRole("combobox", { name: "Category" });
  await category.click();
  const menu = page.getByTestId("seller-category-menu");
  const firstOption = page.getByRole("option").first();
  await expect(menu).toBeVisible();
  await expect(firstOption).toBeVisible();
  const contrast = await firstOption.evaluate((option) => {
    const menu = option.closest('[data-testid="seller-category-menu"]')!;
    const rgb = (color: string) => [...color.matchAll(/\d+(?:\.\d+)?/g)].slice(0, 3).map((part) => Number(part[0]) / 255);
    const luminance = (color: string) => rgb(color).map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4)
      .reduce((sum, part, index) => sum + part * [0.2126, 0.7152, 0.0722][index], 0);
    const text = luminance(getComputedStyle(option).color);
    const background = luminance(getComputedStyle(menu).backgroundColor);
    return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  const firstName = await firstOption.innerText();
  await firstOption.click();
  await expect(category).toContainText(firstName);
  await category.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(category).toContainText(firstName);
});

test("wallet explains withdrawal threshold without an impossible amount field", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: /Your balance/i })).toBeVisible();
  await expect(page.getByText(/more to request a withdrawal/i)).toBeVisible();
  await expect(page.locator("#payout-amount")).toHaveCount(0);
});

test("buyer wallet shows payment status and readable mobile token activity", async ({ page, context }) => {
  await result(admin.from("topup_requests").insert({ user_id: buyer.user.id, method: "crypto", tokens: 500, status: "pending" }).select("id").single());
  await authenticate(context, buyer);
  await page.goto("/wallet");
  await expect(page.getByText("Recent top-up payments", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /500 tokens.*Crypto.*Pending/i })).toBeVisible();
  await expect(page.getByText("Token activity", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdrawals" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Earnings" })).toHaveCount(0);
  await expect(page.getByText("Call purchase").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("token checkout scrolls to the next step on a phone", async ({ page, context }) => {
  await authenticate(context, buyer);
  await page.goto("/wallet/topup");
  await page.locator('[data-pack-tokens="500"]').click();
  await expect.poll(() => page.getByTestId("pack-continue").evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(190);
  await page.getByTestId("pack-continue").getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("payment-method-step")).toBeVisible();
  await expect.poll(() => page.getByTestId("payment-method-step").evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(190);
});

test("seller dashboard shows wallet balance and buyers see an open seller online", async ({ page, context, browser }) => {
  await result(admin.rpc("wallet_credit", { _user_id: seller.user.id, _amount: 90, _entry_type: "support_adjustment", _ref_type: "test_fixture", _ref_id: randomUUID(), _description: "Dashboard balance regression", _created_by: null }));
  await authenticate(context, seller);
  await page.goto("/seller");
  await expect(page.getByRole("heading", { name: "Seller dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open wallet" }).locator("xpath=../..")).toContainText("90");
  const switcher = page.getByRole("switch", { name: "Online status" });
  await expect(switcher).toHaveAttribute("aria-checked", "false");
  const customerContext = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    const customerPage = await customerContext.newPage();
    await customerPage.goto(`/listings/${slug}`);
    await expect(customerPage.getByText("Offline", { exact: true })).toBeVisible();
    await switcher.click();
    await expect(switcher).toHaveAttribute("aria-checked", "true");
    await customerPage.reload();
    await expect(customerPage.getByText("Available now", { exact: true })).toBeVisible();
    await result(admin.from("seller_profiles").update({ last_seen_at: new Date(Date.now() - 180_000).toISOString() }).eq("user_id", seller.user.id).select("id").single());
    await page.goto("/browse");
    await expect.poll(async () => {
      const { data } = await admin.from("seller_profiles").select("last_seen_at").eq("user_id", seller.user.id).single();
      return Boolean(data?.last_seen_at && Date.now() - new Date(data.last_seen_at).getTime() < 90_000);
    }).toBe(true);
    await page.goto("/seller");
    await switcher.click();
    await expect(switcher).toHaveAttribute("aria-checked", "false");
    await customerPage.reload();
    await expect(customerPage.getByText("Offline", { exact: true })).toBeVisible();
    await switcher.click();
    await expect(switcher).toHaveAttribute("aria-checked", "true");
    await customerPage.reload();
    await expect(customerPage.getByText("Available now", { exact: true })).toBeVisible();
  } finally {
    await customerContext.close();
  }
});

test("buyer can sign in, book an online seller and join without picking a time", async ({ page }) => {
  await result(admin.from("seller_profiles").update({ last_seen_at: new Date().toISOString() }).eq("user_id", seller.user.id).select("id").single());
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(`/listings/${slug}?slot=${slotId}`)}`);
  await page.getByLabel("Email", { exact: true }).fill(buyer.user.email!);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Book and join now" })).toBeVisible();
  await page.getByRole("button", { name: "Book and join now" }).click();
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Regression Call", exact: true })).toBeVisible();
  await expect(page.getByText("Call booked", { exact: false }).first()).toBeVisible();
  await expect(page.locator('[data-join-call="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
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
    await expect(sellerPage).toHaveURL(/\/seller\/listings$/);
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

test("phone call chat opens as a full-height scrollable panel with controls visible", async ({ page, context }) => {
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
  expect(box!.y).toBeLessThan(100);
  expect(box!.y + box!.height).toBeLessThan(844);
  await expect(panel.locator(".lk-chat-messages")).toHaveCSS("overflow-y", "auto");
  await expect(panel.locator(".lk-chat-form")).toBeVisible();
  const scrollMetrics = await panel.locator(".lk-chat-messages").evaluate((element) => {
    const sample = document.createElement("div");
    sample.style.height = "1800px";
    sample.style.minHeight = "1800px";
    sample.style.flexShrink = "0";
    element.append(sample);
    element.scrollTop = element.scrollHeight;
    const metrics = { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop, height: getComputedStyle(element).height, parentHeight: getComputedStyle(element.parentElement!).height };
    sample.remove();
    return metrics;
  });
  expect(scrollMetrics.scrollHeight > scrollMetrics.clientHeight && scrollMetrics.scrollTop > 0, JSON.stringify(scrollMetrics)).toBe(true);
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
    }, { timeout: 20_000 }).toBe("released");
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
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/orders/${callBookingId}`);
  const text = `New message ${stamp}`;
  await admin.from("booking_messages").insert({ chat_id: callChatId, sender_id: buyer.user.id, body: text });
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await admin.from("bookings").update({ status: "released" }).eq("id", callBookingId);
  await expect(page.locator('[data-join-call="disabled"]')).toHaveText("Call ended");
  expect(errors).toEqual([]);
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

test("seller sees a booked order become a running call", async ({ page, context }) => {
  const start = Date.now() + 72 * 60 * 60_000;
  const slot = await result(admin.from("availability_slots").insert({ listing_id: listingId, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 30 * 60_000).toISOString(), price_tokens: 200, status: "open" }).select("id").single());
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${buyer.access_token}` } } });
  const booking = await result(client.rpc("purchase_slot", { _slot_id: slot.id }));
  await authenticate(context, seller);
  await page.goto("/seller/orders");
  await page.getByRole("button", { name: /Notifications/ }).click();
  const notices = page.getByRole("dialog", { name: "Notifications" });
  await expect(notices.getByText("New video call booked").first()).toBeVisible();
  await expect(notices.getByRole("button", { name: "Booking sound on" })).toBeVisible();
  await notices.getByRole("button", { name: "Close notifications" }).click();
  const bookedRow = page.locator(`a[href="/orders/${booking.booking_id}"]`);
  await expect(bookedRow.getByText("Slot booked")).toBeVisible();
  await expect(page.getByTestId("seller-booking-realtime")).toHaveAttribute("data-connected", "true");
  const { error } = await admin.from("bookings").update({ status: "live" }).eq("id", booking.booking_id);
  if (error) throw error;
  await expect(bookedRow.getByText("Video call running")).toBeVisible();
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

test("seller orders use the saved region rather than the device region", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/account");
  await page.getByLabel("Your time zone").selectOption("Asia/Karachi");
  await page.getByRole("button", { name: "Save time zone" }).click();
  await expect(page.getByText("Time zone saved.")).toBeVisible();
  await page.goto("/seller/orders");
  const expected = await page.evaluate(iso => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), callStartIso);
  await expect(page.locator(`a[href="/orders/${callBookingId}"]`)).toContainText(expected);
});

test("seller can upload a larger public profile photo", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/seller/profile");
  await expect(page.getByRole("heading", { name: "Your profile." })).toBeVisible();
  await page.locator('#seller-photo').setInputFiles({
    name: "avatar.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R7sAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByAltText("Seller profile preview")).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Seller profile updated.")).toBeVisible();
  const { data } = await admin.from("seller_profiles").select("avatar_url").eq("user_id", seller.user.id).single();
  expect(data?.avatar_url).toMatch(new RegExp(`^${seller.user.id}/avatar-\\d+\\.png$`));
});

test("account photo updates the seller photo and rejects another user's image", async ({ page, context }) => {
  await authenticate(context, seller);
  await page.goto("/account");
  await page.locator("#account-photo").setInputFiles({
    name: "new-profile.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R7sAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByText("Profile photo updated.")).toBeVisible();
  const account = await result(admin.from("profiles").select("avatar_url").eq("id", seller.user.id).single());
  const sellerProfile = await result(admin.from("seller_profiles").select("avatar_url").eq("user_id", seller.user.id).single());
  expect(account.avatar_url).toMatch(new RegExp(`^${seller.user.id}/avatar-.*\\.png$`));
  expect(sellerProfile.avatar_url).toBe(account.avatar_url);
  const otherClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await otherClient.auth.setSession({ access_token: buyer.access_token, refresh_token: buyer.refresh_token });
  const { error } = await otherClient.rpc("set_own_profile_photo", { _path: account.avatar_url });
  expect(error).toBeTruthy();
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
  const expected = await page.evaluate(iso => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" }).replace(/\b(am|pm)\b/i, m => m.toUpperCase()), callStartIso);
  await expect(page.locator(`a[href="/orders/${callBookingId}"] time`)).toContainText(expected);
});

test.afterAll(async () => {
  // Preserve users, orders and ledger history; hide this test listing.
  if (listingId) await admin.from("listings").update({ is_active: false }).eq("id", listingId);
});


test("owner can add tokens with a reason and admin errors stay visible", async ({ page, context }) => {
  await admin.from("user_roles").insert({ user_id: moderator.user.id, role: "owner" }).throwOnError();
  try {
    await authenticate(context, moderator);
    await page.goto("/admin/customers?q=Regression%20Buyer");
    const row = page.locator(`[data-member-id="${buyer.user.id}"]`);
    const before = await result(admin.rpc("wallet_get_balance", { _user_id: buyer.user.id }));
    await row.getByRole("button", { name: "Add tokens" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Tokens to add").fill("17");
    await dialog.getByLabel("Reason", { exact: true }).fill("Local regression credit verification");
    await dialog.getByRole("button", { name: "Add tokens", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await result(admin.rpc("wallet_get_balance", { _user_id: buyer.user.id }))).toBe(Number(before) + 17);
    await page.goto("/admin/customers?q=Regression%20support");
    await page.locator(`[data-member-id="${moderator.user.id}"]`).getByRole("button", { name: "Ban member" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ban member", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("You cannot ban your own account.");
  } finally {
    await admin.from("user_roles").delete().eq("user_id", moderator.user.id).eq("role", "owner");
  }
});
