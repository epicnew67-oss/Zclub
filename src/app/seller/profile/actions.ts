"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateSellerProfileAction(input: {
  displayName: string;
  tagline: string;
  bio: string;
  avatarPath: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const displayName = input.displayName.trim();
  const tagline = input.tagline.trim();
  const bio = input.bio.trim();
  if (displayName.length < 2 || displayName.length > 80 || tagline.length > 120 || bio.length > 2000) {
    return { ok: false, error: "Check the name, tagline, and bio lengths." };
  }
  if (input.avatarPath && !/^[-0-9a-f]{36}\/avatar-[0-9]+\.(jpg|jpeg|png|webp)$/i.test(input.avatarPath)) {
    return { ok: false, error: "Invalid image path." };
  }
  if (input.avatarPath && !input.avatarPath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid image owner." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("seller_profiles")
    .update({ display_name: displayName, tagline, bio,
      ...(input.avatarPath ? { avatar_url: input.avatarPath } : {}), updated_at: new Date().toISOString() })
    .eq("user_id", user.id).eq("is_active", true).is("soft_deleted_at", null)
    .select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save your seller profile." };
  revalidatePath("/seller/profile");
  revalidatePath("/browse");
  revalidatePath("/seller");
  return { ok: true };
}
