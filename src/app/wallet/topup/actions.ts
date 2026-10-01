"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  beginManualTopup,
  createCryptoTopup,
  submitManualTopup,
} from "@/lib/topups/server";

export async function createCryptoTopupAction(packId: string, returnUrl: string) {
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
    });
    return { topupId: result.topupId, returnUrl } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the crypto invoice.";
    return { error: message } as const;
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
