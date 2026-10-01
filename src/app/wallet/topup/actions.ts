"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  beginManualTopup,
  createCryptoTopup,
  fetchUsdPerPkr,
  submitManualTopup,
  syncCryptoPaymentForTopup,
} from "@/lib/topups/server";
import { fetchNowPaymentsMinUsd, listCryptoCurrencies } from "@/lib/nowpayments";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CryptoCurrency } from "@/lib/topups/types";

export async function createCryptoTopupAction(
  packId: string,
  currency: string,
  returnUrl: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sign in required." } as const;
  }

  try {
    const result = await createCryptoTopup({
      userId: user.id,
      userEmail: user.email ?? undefined,
      packId,
      currency,
    });
    return { topupId: result.topupId, returnUrl } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the crypto payment.";
    return { error: message } as const;
  }
}

/**
 * Coins currently enabled for our NOWPayments account (server-fetched and
 * cached; the browser never sees the API key).
 */
export async function listCryptoCurrenciesAction(): Promise<
  { currencies: CryptoCurrency[] } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required." };

  try {
    const currencies = await listCryptoCurrencies();
    if (currencies.length === 0) {
      return { error: "No crypto currencies are available right now — try JazzCash or Easypaisa." };
    }
    return { currencies };
  } catch {
    return { error: "Could not load the currency list — try again." };
  }
}

/**
 * Guidance for the selector: the coin's live network minimum vs this
 * pack's USD price (both resolved server-side).
 */
export async function getCryptoCoinInfoAction(
  packId: string,
  currency: string
): Promise<{ minUsd: number | null; packUsd: number | null } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required." };

  try {
    const admin = createAdminClient();
    const { data: pack } = await admin
      .from("token_packs")
      .select("price_pkr")
      .eq("id", packId)
      .eq("is_active", true)
      .maybeSingle();
    if (!pack) return { error: "Token pack not found." };

    const [{ rate }, minUsd] = await Promise.all([
      fetchUsdPerPkr(),
      fetchNowPaymentsMinUsd(currency.trim().toLowerCase()),
    ]);
    return {
      minUsd,
      packUsd: Math.ceil(pack.price_pkr * rate * 100) / 100,
    };
  } catch {
    return { error: "Could not check this coin right now." };
  }
}

/**
 * Pulls the live NOWPayments status for the caller's crypto payment and
 * applies it through the same idempotent server-side path as the IPN.
 * The client only asks our server to re-check — it never supplies status.
 */
export async function syncCryptoTopupAction(topupId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required." } as const;

  try {
    const admin = createAdminClient();
    const { data: topup } = await admin
      .from("topup_requests")
      .select("id, user_id")
      .eq("id", topupId)
      .maybeSingle();
    if (!topup || topup.user_id !== user.id) {
      return { error: "Top-up not found." } as const;
    }

    const result = await syncCryptoPaymentForTopup(topupId);
    return result
      ? ({ ok: true, ...result } as const)
      : ({ ok: true, status: null, payStatus: null } as const);
  } catch {
    return { error: "Could not refresh the payment status." } as const;
  }
}

export async function beginManualTopupAction(
  packId: string,
  method: "jazzcash" | "easypaisa"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sign in required." } as const;
  }

  // Top-up entries are APPEND-ONLY ledger triggers + status fallthrough;
  // the server validates pack membership (never free-typed numbers).
  try {
    const result = await beginManualTopup({
      userId: user.id,
      userEmail: user.email ?? undefined,
      packId,
      method,
    });
    revalidatePath("/wallet/topup");
    return result as { topupId: string; referenceCode: string; expiresAt: string; pricePkr: number; tokens: number };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the top-up.";
    return { error: message } as const;
  }
}

export async function submitManualTopupAction(args: {
  topupId: string;
  transactionId: string;
  senderNumber: string;
  screenshotPath: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sign in required." } as const;
  }

  try {
    await submitManualTopup({
      userId: user.id,
      topupId: args.topupId,
      transactionId: args.transactionId,
      senderNumber: args.senderNumber,
      screenshotPath: args.screenshotPath,
    });
    revalidatePath("/wallet/topup");
    return { ok: true } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Submission failed.";
    return { error: message } as const;
  }
}
