/**
 * NOWPayments API client + IPN signature canonicalization.
 *
 * Server-only: uses the API key. Sandbox supported via
 * NOWPAYMENTS_BASE_URL = https://api-sandbox.nowpayments.io.
 */

import "server-only";

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

export type NowPaymentsInvoice = {
  payment_id: string | number;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  pay_amount: number;
  invoice_url: string;
  [key: string]: unknown;
};

export function isNowPaymentsConfigured() {
  return Boolean(process.env.NOWPAYMENTS_API_KEY);
}

/**
 * Create a NOWPayments invoice. The price is locked at creation: the PKR→USD
 * rate used is recorded by the caller (payments.rate_lock) so the invoice
 * can never be re-derived from a drifting rate.
 */
export async function createNowPaymentsInvoice(args: {
  priceUsd: number;
  description: string;
  orderId: string;
  ipnCallbackUrl?: string;
}): Promise<NowPaymentsInvoice> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new Error("NOWPayments is not configured (NOWPAYMENTS_API_KEY).");
  }

  const response = await fetch(`${nowPaymentsBaseUrl()}/v1/payment`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: Number(args.priceUsd.toFixed(2)),
      price_currency: "usd",
      // NOWPayments rejects bare "usdt" ("Pay currency USDT is not
      // allowed") — tickers are network-specific. usdttrc20 is enabled
      // on the production account; override with NOWPAYMENTS_PAY_CURRENCY
      // (e.g. usdterc20 / btcbsc) if the store's coins change.
      pay_currency: process.env.NOWPAYMENTS_PAY_CURRENCY ?? "usdttrc20",
      order_id: args.orderId,
      order_description: args.description,
      ...(args.ipnCallbackUrl
        ? { ipn_callback_url: args.ipnCallbackUrl }
        : {}),
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as
    | (NowPaymentsInvoice & { message?: string })
    | null;

  if (!response.ok || !data || !data.payment_id) {
    throw new Error(
      data?.message ?? `NOWPayments invoice failed (HTTP ${response.status})`
    );
  }

  return data;
}
