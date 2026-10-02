"use server";

import { headers } from "next/headers";
import { isSafeImagePath } from "@/lib/safe-image-path";
import { createClient } from "@/lib/supabase/server";
import { alertNewSellerApplication } from "@/lib/admin-alerts";

const ALLOWED_GENDERS = new Set([
  "male",
  "female",
  "non_binary",
  "other",
  "prefer_not_to_say",
]);

function clientIp(headersList: Awaited<ReturnType<typeof headers>>): string {
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headersList.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  // Last-resort fallback — we always store something rather than null
  // so the row satisfies the "IP recorded for compliance" intent.
  return "unknown";
}

export type SubmitSellerApplicationInput = {
  displayName: string;
  gender: string;
  offering: string;
  avatarPath: string | null;
  termsVersion: string;
};

export type SubmitSellerApplicationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server-side wrapper around `submit_seller_application`. Captures the
 * client IP from request headers (more reliable than browser-side
 * third-party services) and validates the payload before the RPC sees it.
 */
export async function submitSellerApplicationAction(
  input: SubmitSellerApplicationInput
): Promise<SubmitSellerApplicationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in required." };
  }

  const displayName = input.displayName.trim();
  const gender = input.gender.trim().toLowerCase();
  const offering = input.offering.trim();
  const termsVersion = input.termsVersion.trim();
  const avatarPath = input.avatarPath?.trim() || null;

  if (displayName.length < 2 || displayName.length > 80) {
    return { ok: false, error: "Display name must be 2–80 characters." };
  }
  if (!ALLOWED_GENDERS.has(gender)) {
    return { ok: false, error: "Invalid gender." };
  }
  if (offering.length < 10 || offering.length > 1000) {
    return { ok: false, error: "Tell buyers what you want to sell (10–1000 characters)." };
  }
  if (!termsVersion) {
    return { ok: false, error: "Terms version missing — refresh the page." };
  }
  if (avatarPath && (!avatarPath.startsWith(`${user.id}/`) || !isSafeImagePath(avatarPath))) {
    return { ok: false, error: "Choose a JPG, PNG, or WebP profile photo from your account." };
  }

  const headersList = await headers();
  const ip = clientIp(headersList);

  const { error } = await supabase.rpc("submit_seller_application", {
    _display_name: displayName,
    _gender: gender,
    _offering: offering,
    _avatar_url: avatarPath,
    _terms_version: termsVersion,
    _terms_ip: ip,
  } as never);

  if (error) {
    return { ok: false, error: error.message };
  }

  // Best-effort fan-out to admin/finance.
  void alertNewSellerApplication({
    applicationId: user.id,
    displayName,
  }).catch((err) => console.warn("[seller-app] admin alert failed", err));

  return { ok: true };
}
