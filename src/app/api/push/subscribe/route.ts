import { NextResponse } from "next/server";
import { deletePushSubscription, savePushSubscription } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  const p256dh = body?.keys?.p256dh as string | undefined;
  const auth = body?.keys?.auth as string | undefined;
  const userAgent = body?.userAgent as string | undefined;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }
  const result = await savePushSubscription({ endpoint, keys: { p256dh, auth }, userAgent });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  if (!endpoint) return NextResponse.json({ ok: false, error: "endpoint required" }, { status: 400 });
  const result = await deletePushSubscription(endpoint);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
