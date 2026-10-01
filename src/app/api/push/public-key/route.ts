import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/push";

export const runtime = "nodejs";

export async function GET() {
  const publicKey = await getVapidPublicKey();
  return NextResponse.json({ publicKey });
}
