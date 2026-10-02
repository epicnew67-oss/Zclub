import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSafeImagePath } from "@/lib/safe-image-path";
import { SellerProfileEditor } from "@/components/seller/seller-profile-editor";

export const metadata: Metadata = { title: "Seller profile" };

export default async function SellerProfilePage() {
  const { user } = await requireUser("/seller/profile");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("seller_profiles")
    .select("display_name, tagline, bio, avatar_url, slug")
    .eq("user_id", user.id).is("soft_deleted_at", null).maybeSingle();
  if (!profile) return <p className="p-8">Seller profile unavailable.</p>;
  const { data: avatar } = isSafeImagePath(profile.avatar_url)
    ? await admin.storage.from("seller-avatars").createSignedUrl(profile.avatar_url, 600)
    : { data: null };
  return <div className="mx-auto max-w-3xl px-4 py-8 md:px-6"><h1 className="font-heading text-3xl text-gold">Seller profile</h1><p className="mt-2 text-sm text-muted-foreground">Your photo and details appear beside every service you list.</p><SellerProfileEditor initial={{ displayName: profile.display_name, tagline: profile.tagline ?? "", bio: profile.bio ?? "", avatarUrl: avatar?.signedUrl ?? null }} /></div>;
}
