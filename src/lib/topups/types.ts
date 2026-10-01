// Client-safe top-up types + bucket + return-url sanitizer.
// Never import anything server-only from here.

export type TopupMethod = "crypto" | "jazzcash" | "easypaisa";

export type TokenPack = {
  id: string;
  label: string;
  price_pkr: number;
  tokens: number;
};

export type ManualAccount = {
  account_number: string;
  account_name: string;
  qr_data_url: string | null;
};

export type PaymentRates = {
  usd_per_pkr: number;
  crypto_min_usd: number;
};

export const TOPUP_SCREENSHOT_BUCKET = "topup-screenshots";

/** A coin enabled for our NOWPayments account (server-fetched, client-safe shape). */
export type CryptoCurrency = {
  code: string;
  name: string;
  network: string | null;
  logoUrl: string | null;
  popular: boolean;
};

// Network suffixes used by NOWPayments tickers (usdttrc20 → USDT TRC20).
const NETWORK_SUFFIXES: Array<[RegExp, string]> = [
  [/trc20$/, "TRC20"],
  [/erc20$/, "ERC20"],
  [/bsc$/, "BSC"],
  [/sol$/, "SOL"],
  [/base$/, "BASE"],
  [/arb$/, "ARB"],
  [/matic$/, "Polygon"],
  [/op$/, "OP"],
  [/avax$/, "AVAX"],
  [/ton$/, "TON"],
  [/apt$/, "APT"],
  [/celo$/, "CELO"],
];

/** "usdttrc20" → { symbol: "USDT", network: "TRC20" }; "ltc" → { symbol: "LTC", network: null }. */
export function formatCryptoCode(code: string | null | undefined): {
  symbol: string;
  network: string | null;
} {
  if (!code) return { symbol: "CRYPTO", network: null };
  const lower = code.toLowerCase();
  for (const [pattern, network] of NETWORK_SUFFIXES) {
    if (pattern.test(lower)) {
      return { symbol: lower.replace(pattern, "").toUpperCase(), network };
    }
  }
  return { symbol: lower.toUpperCase(), network: null };
}

// Reused by finance queue + status pages on both server + client.
export type TopupStatusData = {
  topup: {
    id: string;
    method: TopupMethod;
    tokens: number;
    status: "pending" | "completed" | "failed" | "expired";
    reference_code: string | null;
    expires_at: string | null;
    transaction_id: string | null;
    review_note: string | null;
    created_at: string;
  };
  payment: {
    id: string;
    external_id: string;
    invoice_url: string | null;
    pay_address: string | null;
    pay_amount: number | null;
    pay_currency: string | null;
    pay_expires_at: string | null;
    pay_status: string | null;
    price_usd: number | null;
    price_pkr: number;
  } | null;
  pack: { label: string; price_pkr: number } | null;
};

export type FinanceQueueItem = {
  id: string;
  created_at: string;
  method: TopupMethod;
  tokens: number;
  price_pkr: number | null;
  buyer_email: string | null;
  buyer_name: string | null;
  reference_code: string | null;
  transaction_id: string | null;
  sender_number: string | null;
  screenshot_path: string | null;
  screenshot_url: string | null;
  expires_at: string | null;
  payment_needs_review: boolean | null;
  payment_flag_reason: string | null;
  payment_external_id: string | null;
  payment_actually_paid: number | null;
  payment_pay_amount: number | null;
};

/**
 * `return` URLs must stay on-site: relative paths or same-origin absolute.
 * Prevents open redirects after payment.
 */
export function sanitizeReturnUrl(value: string | null | undefined): string {
  const fallback = "/wallet";
  if (!value) return fallback;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const siteOrigin = new URL(origin).origin;
    const url = new URL(value);
    if (url.origin === siteOrigin) return `${url.pathname}${url.search}`;
  } catch {
    // fall through to the fallback
  }
  return fallback;
}
