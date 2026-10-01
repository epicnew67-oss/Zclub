/**
 * Server-side top-up helpers. All money moves go through the DB RPCs
 * (wallet_credit / finance_approve_topup / nowpayments_webhook_apply) —
 * these helpers only create/track rows and call those RPCs.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { alertNewTopup } from "@/lib/admin-alerts";
import {
  createNowPaymentsInvoice,
  fetchCryptoMinUsd,
  isNowPaymentsConfigured,
} from "@/lib/nowpayments";
import type {
  TopupMethod,
  TokenPack,
  ManualAccount,
  PaymentRates,
  TopupStatusData,
  FinanceQueueItem,
} from "./types";
import { TOPUP_SCREENSHOT_BUCKET, sanitizeReturnUrl } from "./types";

export type {
  TopupMethod,
  TokenPack,
  ManualAccount,
  PaymentRates,
  TopupStatusData,
  FinanceQueueItem,
};
export { TOPUP_SCREENSHOT_BUCKET, sanitizeReturnUrl };

// ---------------------------------------------------------------- helpers

const TOPUP_WINDOW_MINUTES = 30;

function referenceCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "SC-";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export async function getTokenPacks(): Promise<TokenPack[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("token_packs")
    .select("id, label, price_pkr, tokens")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as TokenPack[];
}

export async function getManualAccount(
  method: "jazzcash" | "easypaisa"
): Promise<ManualAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("settings")
    .select("value")
    .eq("key", method)
    .maybeSingle();
  const value = data?.value as ManualAccount | undefined | null;
  return value && value.account_number ? value : null;
}

export async function getPaymentRates(): Promise<PaymentRates> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("settings")
    .select("value")
    .eq("key", "payment_rates")
    .maybeSingle();
  const value = (data?.value ?? {}) as Partial<PaymentRates>;
  return {
    usd_per_pkr: Number(value.usd_per_pkr) || 0.0036,
    crypto_min_usd: Number(value.crypto_min_usd) || 1.5,
  };
}

/**
 * Live PKR→USD rate with the settings value as fallback. The caller locks
 * whatever this returns into payments.rate_lock.
 */
export async function fetchUsdPerPkr(): Promise<{
  rate: number;
  source: string;
}> {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/PKR", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        rates?: { USD?: number };
      };
      const rate = Number(data?.rates?.USD);
      if (rate > 0) {
        return { rate, source: "open.er-api.com" };
      }
    }
  } catch {
    // fall back to the settings rate
  }
  const rates = await getPaymentRates();
  return { rate: rates.usd_per_pkr, source: "settings" };
}

// ---------------------------------------------------------------- crypto

export async function createCryptoTopup(args: {
  userId: string;
  userEmail?: string;
  packId: string;
}): Promise<{
  topupId: string;
  invoiceUrl: string | null;
  payAddress: string | null;
  payAmount: number | null;
  payCurrency: string | null;
  priceUsd: number | null;
}> {
  if (!isNowPaymentsConfigured()) {
    throw new Error(
      "Crypto top-ups are not configured (NOWPAYMENTS_API_KEY missing)."
    );
  }

  const admin = createAdminClient();
  const { data: pack, error: packError } = await admin
    .from("token_packs")
    .select("id, label, price_pkr, tokens")
    .eq("id", args.packId)
    .eq("is_active", true)
    .single();
  if (packError || !pack) {
    throw new Error("Token pack not found.");
  }

  const { rate, source } = await fetchUsdPerPkr();
  const rates = await getPaymentRates();
  const priceUsd = Math.ceil(pack.price_pkr * rate * 100) / 100;

  // NOWPayments enforces a per-coin network minimum (USDT-TRC20 was
  // ~$11.5 on the production account). Use the live minimum when
  // available, else the settings threshold, so small packs get a clear
  // "use JazzCash/Easypaisa" message instead of a raw API error.
  const payCurrency = process.env.NOWPAYMENTS_PAY_CURRENCY ?? "usdttrc20";
  const liveMinUsd = await fetchCryptoMinUsd(payCurrency);
  const minUsd = liveMinUsd ?? rates.crypto_min_usd;
  if (priceUsd < minUsd) {
    throw new Error(
      `Crypto top-ups start at ~$${minUsd.toFixed(2)} (network minimum). This pack is $${priceUsd.toFixed(2)} — please pay with JazzCash or Easypaisa instead.`
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const invoice = await createNowPaymentsInvoice({
    priceUsd,
    description: `${pack.tokens} tokens (${pack.label} pack)`,
    orderId: `pack-${pack.id}-${Date.now()}`,
    ipnCallbackUrl: `${siteUrl}/api/webhooks/nowpayments`,
  });

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .insert({
      user_id: args.userId,
      external_id: String(invoice.payment_id),
      token_pack_id: pack.id,
      status: "pending",
      price_pkr: pack.price_pkr,
      tokens: pack.tokens,
      pay_currency: invoice.pay_currency ?? "usdttrc20",
      pay_amount: invoice.pay_amount ?? priceUsd,
      price_usd: priceUsd,
      rate_lock: {
        usd_per_pkr: rate,
        source,
        locked_at: new Date().toISOString(),
      },
      invoice_url: invoice.invoice_url ?? null,
    })
    .select("id")
    .single();
  if (paymentError) throw paymentError;

  const { data: topup, error: topupError } = await admin
    .from("topup_requests")
    .insert({
      user_id: args.userId,
      payment_id: payment.id,
      method: "crypto",
      token_pack_id: pack.id,
      tokens: pack.tokens,
      status: "pending",
    })
    .select("id")
    .single();
  if (topupError) throw topupError;

  // Best-effort fan-out to admin/finance. Failures don't block the
  // top-up — the row is already created; the bell + push just won't
  // reach anyone who isn't subscribed yet.
  void alertNewTopup({
    topupId: topup.id,
    amountPkr: pack.price_pkr,
    tokens: pack.tokens,
    method: "crypto",
    buyerEmail: args.userEmail ?? "",
  }).catch((err) => console.warn("[topup] admin alert failed", err));

  return {
    topupId: topup.id,
    invoiceUrl: invoice.invoice_url ?? null,
    payAddress: invoice.pay_address ?? null,
    payAmount: invoice.pay_amount ?? null,
    payCurrency: invoice.pay_currency ?? null,
    priceUsd,
  };
}

// ---------------------------------------------------------------- manual

export async function beginManualTopup(args: {
  userId: string;
  userEmail?: string;
  packId: string;
  method: "jazzcash" | "easypaisa";
}): Promise<{
  topupId: string;
  referenceCode: string;
  expiresAt: string;
  pricePkr: number;
  tokens: number;
}> {
  const admin = createAdminClient();
  const { data: pack, error: packError } = await admin
    .from("token_packs")
    .select("id, price_pkr, tokens")
    .eq("id", args.packId)
    .eq("is_active", true)
    .single();
  if (packError || !pack) {
    throw new Error("Token pack not found.");
  }

  const expiresAt = new Date(Date.now() + TOPUP_WINDOW_MINUTES * 60 * 1000);

  // Retry on the (unlikely) reference-code collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = referenceCode();
    const { data: topup, error } = await admin
      .from("topup_requests")
      .insert({
        user_id: args.userId,
        method: args.method,
        token_pack_id: pack.id,
        tokens: pack.tokens,
        status: "pending",
        reference_code: code,
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single();

    if (!error && topup) {
      void alertNewTopup({
        topupId: topup.id,
        amountPkr: pack.price_pkr,
        tokens: pack.tokens,
        method: args.method,
        buyerEmail: args.userEmail ?? "",
      }).catch((err) => console.warn("[topup] admin alert failed", err));

      return {
        topupId: topup.id,
        referenceCode: code,
        expiresAt: expiresAt.toISOString(),
        pricePkr: pack.price_pkr,
        tokens: pack.tokens,
      };
    }
    const message = (error as { message?: string } | null)?.message ?? "";
    if (!message.includes("topups_reference_code_unique")) {
      throw error ?? new Error("Could not start the top-up.");
    }
  }
  throw new Error("Could not allocate a reference code — try again.");
}

export async function submitManualTopup(args: {
  userId: string;
  topupId: string;
  transactionId: string;
  senderNumber: string;
  screenshotPath: string | null;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: topup, error: topupError } = await admin
    .from("topup_requests")
    .select("id, user_id, method, status, expires_at, transaction_id")
    .eq("id", args.topupId)
    .single();
  if (topupError || !topup) throw new Error("Top-up not found.");
  if (topup.user_id !== args.userId) {
    throw new Error("This top-up belongs to a different account.");
  }
  if (topup.method === "crypto") {
    throw new Error("This top-up is a crypto payment — no submission needed.");
  }
  if (topup.status !== "pending") {
    throw new Error(`This top-up is already ${topup.status}.`);
  }
  if (topup.transaction_id) {
    throw new Error("This top-up already has a submitted payment.");
  }
  if (topup.expires_at && new Date(topup.expires_at) < new Date()) {
    throw new Error("The 30-minute payment window has expired. Start again.");
  }

  const transactionId = args.transactionId.trim();
  if (!/^[A-Za-z0-9-]{4,64}$/.test(transactionId)) {
    throw new Error("Transaction ID must be 4–64 letters, digits or dashes.");
  }
  const senderNumber = args.senderNumber.trim();
  if (!/^[0-9+ -]{7,20}$/.test(senderNumber)) {
    throw new Error("Sender number must be 7–20 digits.");
  }
  if (args.screenshotPath) {
    // The screenshot must live in the uploader's own storage folder.
    if (!args.screenshotPath.startsWith(`${args.userId}/`)) {
      throw new Error("Invalid screenshot location.");
    }
  }

  const { error } = await admin
    .from("topup_requests")
    .update({
      transaction_id: transactionId,
      sender_number: senderNumber,
      screenshot_path: args.screenshotPath,
    })
    .eq("id", args.topupId)
    .eq("user_id", args.userId);

  if (error) {
    if (error.message.includes("topup_requests_transaction_id_key")) {
      throw new Error(
        "This transaction ID was already submitted. Each bank transfer can only be claimed once."
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------- status

// Types are re-exported from ./types — see src/lib/topups/types.ts.
export async function getTopupForUser(
  userId: string,
  topupId: string
): Promise<TopupStatusData | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("topup_requests")
    .select(
      `id, method, tokens, status, reference_code, expires_at, transaction_id, review_note, created_at,
       payments ( id, external_id, invoice_url, pay_address, pay_amount, pay_currency, price_usd, price_pkr ),
       token_packs ( label, price_pkr )`
    )
    .eq("id", topupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    method: TopupMethod;
    tokens: number;
    status: TopupStatusData["topup"]["status"];
    reference_code: string | null;
    expires_at: string | null;
    transaction_id: string | null;
    review_note: string | null;
    created_at: string;
    payments: TopupStatusData["payment"] | null;
    token_packs: TopupStatusData["pack"] | null;
  };

  return {
    topup: {
      id: row.id,
      method: row.method,
      tokens: row.tokens,
      status: row.status,
      reference_code: row.reference_code,
      expires_at: row.expires_at,
      transaction_id: row.transaction_id,
      review_note: row.review_note,
      created_at: row.created_at,
    },
    payment: row.payments,
    pack: row.token_packs,
  };
}

// ---------------------------------------------------------------- finance

export async function listFinanceQueue(): Promise<FinanceQueueItem[]> {
  const admin = createAdminClient();

  // Plain single-table selects + an in-JS merge instead of PostgREST
  // embeds: topup_requests has TWO FKs to profiles (user_id, reviewed_by),
  // and this PostgREST rejects both the bare `profiles (...)` embed
  // (PGRST201 ambiguous) and `profiles!<fk-name>` hints for this pair —
  // which crashed the page behind the admin top-up notifications (#42703).
  const { data, error } = await admin
    .from("topup_requests")
    .select(
      "id, created_at, method, tokens, expires_at, reference_code, transaction_id, sender_number, screenshot_path, user_id, token_pack_id, payment_id"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    created_at: string;
    method: TopupMethod;
    tokens: number;
    expires_at: string | null;
    reference_code: string | null;
    transaction_id: string | null;
    sender_number: string | null;
    screenshot_path: string | null;
    user_id: string;
    token_pack_id: string | null;
    payment_id: string | null;
  }>;

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const packIds = [
    ...new Set(rows.map((r) => r.token_pack_id).filter((id): id is string => Boolean(id))),
  ];
  const paymentIds = [
    ...new Set(rows.map((r) => r.payment_id).filter((id): id is string => Boolean(id))),
  ];

  type ProfileRow = { id: string; email: string | null; display_name: string | null };
  type PackRow = { id: string; price_pkr: number | null };
  type PaymentRow = {
    id: string;
    external_id: string | null;
    needs_review: boolean | null;
    flag_reason: string | null;
    actually_paid: number | null;
    pay_amount: number | null;
  };

  const [profilesRes, packsRes, paymentsRes] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id, email, display_name").in("id", userIds)
      : Promise.resolve({ data: [] as ProfileRow[] }),
    packIds.length
      ? admin.from("token_packs").select("id, price_pkr").in("id", packIds)
      : Promise.resolve({ data: [] as PackRow[] }),
    paymentIds.length
      ? admin
          .from("payments")
          .select("id, external_id, needs_review, flag_reason, actually_paid, pay_amount")
          .in("id", paymentIds)
      : Promise.resolve({ data: [] as PaymentRow[] }),
  ]);

  const profileById = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
  const packById = new Map(((packsRes.data ?? []) as PackRow[]).map((p) => [p.id, p]));
  const paymentById = new Map(((paymentsRes.data ?? []) as PaymentRow[]).map((p) => [p.id, p]));

  const items: FinanceQueueItem[] = [];
  for (const row of rows) {
    const profile = profileById.get(row.user_id) ?? null;
    const pack = row.token_pack_id ? packById.get(row.token_pack_id) ?? null : null;
    const payment = row.payment_id ? paymentById.get(row.payment_id) ?? null : null;

    let screenshotUrl: string | null = null;
    if (row.screenshot_path) {
      const { data: signed } = await admin.storage
        .from(TOPUP_SCREENSHOT_BUCKET)
        .createSignedUrl(row.screenshot_path, 600);
      screenshotUrl = signed?.signedUrl ?? null;
    }
    items.push({
      id: row.id,
      created_at: row.created_at,
      method: row.method,
      tokens: row.tokens,
      price_pkr: pack?.price_pkr ?? null,
      buyer_email: profile?.email ?? null,
      buyer_name: profile?.display_name ?? null,
      reference_code: row.reference_code,
      transaction_id: row.transaction_id,
      sender_number: row.sender_number,
      screenshot_path: row.screenshot_path,
      screenshot_url: screenshotUrl,
      expires_at: row.expires_at,
      payment_needs_review: payment?.needs_review ?? null,
      payment_flag_reason: payment?.flag_reason ?? null,
      payment_external_id: payment?.external_id ?? null,
      payment_actually_paid: Number(payment?.actually_paid ?? 0) || null,
      payment_pay_amount: payment?.pay_amount != null ? Number(payment.pay_amount) : null,
    });
  }
  return items;
}
