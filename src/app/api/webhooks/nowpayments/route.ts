import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sortedStringify } from "@/lib/nowpayments";

export const runtime = "nodejs";

/**
 * NOWPayments IPN webhook.
 *
 * NOWPayments POSTs JSON and sets `x-nowpayments-sig` to
 * HMAC-SHA512(sortedStringify(body), IPN_SECRET) (hex).
 * We re-canonicalize in exactly the same way, verify the signature
 * in constant time, then delegate to the DB RPC
 *   nowpayments_webhook_apply(_payment_id, _ipn_status, _actually_paid)
 * so all money/state changes run in one DB transaction.
 *
 * Credits ONLY on `finished`, idempotent by payment ID; partial/expired go
 * to flag review; replays are no-ops; bad signatures are 401'd.
 */

function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

// Cap the request body. NOWPayments IPN payloads are <10 KB in
// practice; anything larger is either a misconfigured upstream or
// an attempt to OOM this route.
const MAX_WEBHOOK_BODY = 64 * 1024;

export async function POST(request: Request) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    return Response.json({ error: "Webhook not configured" }, { status: 501 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_WEBHOOK_BODY) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BODY) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const signature = request.headers.get("x-nowpayments-sig") ?? "";

  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const expected = createHmac("sha512", secret)
    .update(sortedStringify(body))
    .digest("hex");

  if (!timingSafeEqualHex(signature, expected)) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }

  const paymentId =
    body.payment_id != null
      ? String(body.payment_id)
      : body.paymentId != null
        ? String(body.paymentId)
        : null;

  const ipnStatus =
    body.payment_status != null
      ? String(body.payment_status)
      : body.status != null
        ? String(body.status)
        : null;

  if (!paymentId || !ipnStatus) {
    return Response.json({ ok: true, ignored: "missing payment_id or payment_status" });
  }

  const actuallyPaidRaw =
    (body.actually_paid as unknown) ??
    (body.pay_amount as unknown) ??
    (body.payAmount as unknown) ??
    null;
  const actuallyPaid =
    actuallyPaidRaw != null && String(actuallyPaidRaw).trim() !== ""
      ? String(actuallyPaidRaw)
      : null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nowpayments_webhook_apply", {
    _payment_id: paymentId,
    _ipn_status: ipnStatus,
    _actually_paid: actuallyPaid != null ? Number(actuallyPaid) : null,
  } as never);

  if (error) {
    console.error("nowpayments_webhook_apply failed:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  return Response.json(data);
}
