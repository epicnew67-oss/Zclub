/**
 * NOWPayments API client + IPN signature canonicalization.
 *
 * Server-only: uses the API key. Sandbox supported via
 * NOWPAYMENTS_BASE_URL = https://api-sandbox.nowpayments.io.
 *
 * Crypto checkout model: the customer picks an enabled coin in-app, the
 * server creates a direct payment for that coin (pay_currency), and the
 * returned pay_address/pay_amount are shown as the primary payment UI.
 * The API key never reaches the browser.
 */

import "server-only";
import type { CryptoCurrency } from "@/lib/topups/types";

export const NOWPAYMENTS_PRODUCTION_BASE = "https://api.nowpayments.io";
export const NOWPAYMENTS_SANDBOX_BASE = "https://api-sandbox.nowpayments.io";

export function nowPaymentsBaseUrl() {
  return process.env.NOWPAYMENTS_BASE_URL ?? NOWPAYMENTS_PRODUCTION_BASE;
}

/**
 * NOWPayments IPN signature canonicalization: JSON with all keys sorted
 * alphabetically at every level, no whitespace.
 */
export function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => sortedStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${sortedStringify(record[key])}`)
    .join(",")}}`;
}

export function isNowPaymentsConfigured() {
  return Boolean(process.env.NOWPAYMENTS_API_KEY);
}

function authHeaders(): Record<string, string> {
  return { "x-api-key": process.env.NOWPAYMENTS_API_KEY ?? "" };
}

// ---------------------------------------------------------------- catalog

// Coins we always surface first when the account has them enabled, in
// addition to NOWPayments' own `is_popular` flag.
const PINNED_POPULAR = new Set([
  "btc",
  "eth",
  "usdttrc20",
  "usdterc20",
  "usdc",
  "ltc",
  "trx",
  "doge",
  "sol",
  "xrp",
  "ada",
  "bnbbsc",
]);

// Coins the checkout is allowed to offer, in display order. The catalog
// below still comes live from NOWPayments — this is just the allowlist.
export const ALLOWED_CRYPTO_CURRENCIES = [
  "usdttrc20", // USDT — TRON (TRC20)
  "usdterc20", // USDT — Ethereum (ERC20)
  "usdtbsc", //   USDT — BNB Smart Chain (BEP20)
  "usdtsol", //   USDT — Solana
  "ltc", //       Litecoin
  "btc", //       Bitcoin
  "eth", //       Ethereum
  "bnbbsc", //    BNB — BNB Smart Chain (BEP20)
  "usdc", //      USDC — Ethereum (ERC20)
] as const;

let currencyCache: { at: number; data: CryptoCurrency[] } | null = null;
const CURRENCY_TTL_MS = 10 * 60 * 1000;

/**
 * Coins enabled for our NOWPayments account, enriched with names,
 * networks and logos from /v1/full-currencies, then restricted to the
 * checkout allowlist (in its order). The catalog is large (300+), so it
 * is cached in-memory for 10 minutes per server instance. Never
 * hardcoded: this is whatever the account currently supports.
 */
export async function listCryptoCurrencies(): Promise<CryptoCurrency[]> {
  if (!isNowPaymentsConfigured()) return [];
  if (currencyCache && Date.now() - currencyCache.at < CURRENCY_TTL_MS) {
    return currencyCache.data;
  }

  try {
    const [merchantRes, fullRes] = await Promise.all([
      fetch(`${nowPaymentsBaseUrl()}/v1/merchant/coins`, {
        headers: authHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }),
      fetch(`${nowPaymentsBaseUrl()}/v1/full-currencies`, {
        headers: authHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }),
    ]);
    if (!merchantRes.ok || !fullRes.ok) return currencyCache?.data ?? [];

    const merchant = (await merchantRes.json()) as {
      selectedCurrencies?: string[];
    };
    const full = (await fullRes.json()) as {
      currencies?: Array<{
        code?: string;
        name?: string;
        network?: string | null;
        logo_url?: string | null;
        is_popular?: boolean;
        enable?: boolean;
        available_for_payment?: boolean;
      }>;
    };

    const enabled = new Set(
      (merchant.selectedCurrencies ?? []).map((c) => c.toLowerCase())
    );
    const byCode = new Map<string, CryptoCurrency>();
    for (const coin of full.currencies ?? []) {
      const code = coin.code?.toLowerCase();
      if (!code || !enabled.has(code)) continue;
      if (coin.enable === false || coin.available_for_payment === false) continue;
      byCode.set(code, {
        code,
        name: coin.name?.trim() || code.toUpperCase(),
        network: coin.network?.trim() || null,
        logoUrl: coin.logo_url ? `https://nowpayments.io${coin.logo_url}` : null,
        popular: Boolean(coin.is_popular) || PINNED_POPULAR.has(code),
      });
    }

    const data: CryptoCurrency[] = [];
    for (const code of ALLOWED_CRYPTO_CURRENCIES) {
      const coin = byCode.get(code);
      if (coin) data.push(coin);
    }

    currencyCache = { at: Date.now(), data };
    return data;
  } catch {
    return currencyCache?.data ?? [];
  }
}

// ---------------------------------------------------------------- minimums

const minCache = new Map<string, { at: number; usd: number | null }>();
const MIN_TTL_MS = 5 * 60 * 1000;

/**
 * Live minimum payable amount for a coin, in USD (network minimums vary
 * per coin — USDT-TRC20 was ~$11.5, LTC much lower). Returns null when
 * the lookup fails.
 */
export async function fetchNowPaymentsMinUsd(
  currency: string
): Promise<number | null> {
  if (!isNowPaymentsConfigured()) return null;
  const cached = minCache.get(currency);
  if (cached && Date.now() - cached.at < MIN_TTL_MS) return cached.usd;

  try {
    const response = await fetch(
      `${nowPaymentsBaseUrl()}/v1/min-amount?currency_from=${encodeURIComponent(currency)}&fiat_equivalent=usd`,
      {
        headers: authHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    let usd: number | null = null;
    if (response.ok) {
      const data = (await response.json()) as {
        min_amount?: number;
        fiat_equivalent?: number;
      };
      const value = Number(data.fiat_equivalent ?? data.min_amount);
      usd = Number.isFinite(value) && value > 0 ? value : null;
    }
    minCache.set(currency, { at: Date.now(), usd });
    return usd;
  } catch {
    minCache.set(currency, { at: Date.now(), usd: null });
    return null;
  }
}

// ---------------------------------------------------------------- payment

export type NowPaymentsPaymentResult = {
  paymentId: string;
  status: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  payExpiresAt: string | null;
};

type NowPaymentsPaymentPayload = {
  payment_id?: string | number;
  payment_status?: string;
  pay_address?: string;
  pay_amount?: number | string;
  pay_currency?: string;
  expiration_estimate_date?: string | null;
  code?: string;
  message?: string;
};

/**
 * Create a direct payment for a customer-selected coin. The package and
 * fiat amount come from the server (validated pack), never the client.
 */
export async function createNowPaymentsPayment(args: {
  priceUsd: number;
  currency: string;
  description: string;
  orderId: string;
  ipnCallbackUrl?: string;
}): Promise<NowPaymentsPaymentResult> {
  if (!isNowPaymentsConfigured()) {
    throw new Error("NOWPayments is not configured (NOWPAYMENTS_API_KEY).");
  }

  const response = await fetch(`${nowPaymentsBaseUrl()}/v1/payment`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      price_amount: Number(args.priceUsd.toFixed(2)),
      price_currency: "usd",
      pay_currency: args.currency,
      order_id: args.orderId,
      order_description: args.description,
      ...(args.ipnCallbackUrl ? { ipn_callback_url: args.ipnCallbackUrl } : {}),
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as
    | NowPaymentsPaymentPayload
    | null;

  if (!response.ok || !data?.payment_id || !data.pay_address) {
    if (data?.code === "AMOUNT_MINIMAL_ERROR") {
      const minUsd = await fetchNowPaymentsMinUsd(args.currency);
      throw new Error(
        minUsd != null
          ? `The network minimum for this coin is ~$${minUsd.toFixed(2)} — this pack is $${args.priceUsd.toFixed(2)}. Pick another coin or a bigger pack.`
          : "This pack is below the network minimum for that coin — pick another coin or a bigger pack."
      );
    }
    throw new Error(
      data?.message ?? `NOWPayments payment failed (HTTP ${response.status})`
    );
  }

  return {
    paymentId: String(data.payment_id),
    status: String(data.payment_status ?? "waiting"),
    payAddress: String(data.pay_address),
    payAmount: Number(data.pay_amount),
    payCurrency: String(data.pay_currency ?? args.currency),
    payExpiresAt: data.expiration_estimate_date ?? null,
  };
}

export type NowPaymentsPaymentStatus = {
  status: string;
  payAddress: string | null;
  payAmount: number | null;
  payCurrency: string | null;
  actuallyPaid: number | null;
  actuallyPaidFiat: number | null;
  expiresAt: string | null;
};

/**
 * Live status for a payment id — used by the server-side sync so the
 * in-app screen updates even if an IPN is delayed. Results are applied
 * through the same idempotent DB function as the webhook.
 */
export async function fetchNowPaymentsPaymentStatus(
  paymentId: string
): Promise<NowPaymentsPaymentStatus | null> {
  if (!isNowPaymentsConfigured()) return null;
  try {
    const response = await fetch(
      `${nowPaymentsBaseUrl()}/v1/payment/${encodeURIComponent(paymentId)}`,
      {
        headers: authHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      payment_status?: string;
      pay_address?: string;
      pay_amount?: number | string;
      pay_currency?: string;
      actually_paid?: number | string;
      actually_paid_at_fiat?: number | string;
      expiration_estimate_date?: string | null;
    };
    const num = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      status: String(data.payment_status ?? ""),
      payAddress: data.pay_address ?? null,
      payAmount: num(data.pay_amount),
      payCurrency: data.pay_currency ?? null,
      actuallyPaid: num(data.actually_paid),
      actuallyPaidFiat: num(data.actually_paid_at_fiat),
      expiresAt: data.expiration_estimate_date ?? null,
    };
  } catch {
    return null;
  }
}
