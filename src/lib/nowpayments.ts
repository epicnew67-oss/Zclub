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

export type NowPaymentsInvoiceResult = {
  invoiceId: string;
  invoiceUrl: string;
};

export function isNowPaymentsConfigured() {
  return Boolean(process.env.NOWPAYMENTS_API_KEY);
}

/**
 * Create a NOWPayments hosted invoice (POST /v1/invoice). pay_currency is
 * intentionally omitted so the customer picks ANY coin enabled on the
 * account; per-coin network minimums are enforced on the checkout page.
 * The invoice id is what IPNs reference (`invoice_id`), so it is stored
 * as payments.external_id.
 */
export async function createNowPaymentsInvoice(args: {
  priceUsd: number;
  description: string;
  orderId: string;
  ipnCallbackUrl?: string;
}): Promise<NowPaymentsInvoiceResult> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new Error("NOWPayments is not configured (NOWPAYMENTS_API_KEY).");
  }

  const response = await fetch(`${nowPaymentsBaseUrl()}/v1/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: Number(args.priceUsd.toFixed(2)),
      price_currency: "usd",
      order_id: args.orderId,
      order_description: args.description,
      ...(args.ipnCallbackUrl
        ? { ipn_callback_url: args.ipnCallbackUrl }
        : {}),
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as
    | { id?: string | number; invoice_url?: string; message?: string }
    | null;

  if (!response.ok || !data?.id || !data.invoice_url) {
    throw new Error(
      data?.message ?? `NOWPayments invoice failed (HTTP ${response.status})`
    );
  }

  return { invoiceId: String(data.id), invoiceUrl: data.invoice_url };
}
