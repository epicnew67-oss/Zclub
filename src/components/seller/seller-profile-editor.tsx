"use client";

/* eslint-disable @next/next/no-img-element -- The preview uses a local blob URL. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CameraIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateSellerProfileAction } from "@/app/seller/profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function SellerProfileEditor({ initial }: { initial: { displayName: string; tagline: string; bio: string; avatarUrl: string | null } }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [tagline, setTagline] = useState(initial.tagline);
  const [bio, setBio] = useState(initial.bio);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial.avatarUrl);
  const [pending, startTransition] = useTransition();

  function pick(file: File | null) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5_000_000) {
      toast.error("Choose a JPG, PNG, or WebP image under 5 MB.");
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  async function save() {
    const supabase = createClient();
    let avatarPath: string | null = null;
    if (photo) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sign in again."); return; }
      const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
      avatarPath = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("seller-avatars")
        .upload(avatarPath, photo, { contentType: photo.type, upsert: false });
      if (error) { toast.error(error.message); return; }
    }
    const result = await updateSellerProfileAction({ displayName, tagline, bio, avatarPath });
    if (result.ok) { setPhoto(null); toast.success("Seller profile updated."); router.refresh(); }
    else toast.error(result.error);
  }

  return <div className="mt-8 space-y-6 rounded-2xl border border-border bg-surface/40 p-5 md:p-8">
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-gold/50 bg-elevated text-3xl text-gold">
        {preview ? <img src={preview} alt="Seller profile preview" className="size-full object-cover" /> : displayName.slice(0, 2).toUpperCase()}
      </div>
      <div className="space-y-2"><label htmlFor="seller-photo" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10"><CameraIcon className="size-4" /> Change photo</label><input id="seller-photo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">Square JPG, PNG, or WebP; maximum 5 MB.</p></div>
    </div>
    <label className="block space-y-2 text-sm"><span>Display name</span><Input value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} /></label>
    <label className="block space-y-2 text-sm"><span>Tagline</span><Input value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} placeholder="A short introduction" /></label>
    <label className="block space-y-2 text-sm"><span>About you</span><Textarea value={bio} maxLength={2000} rows={5} onChange={(e) => setBio(e.target.value)} /></label>
    <Button disabled={pending} onClick={() => startTransition(() => { void save(); })} className="bg-burgundy text-white">{pending ? "Saving…" : "Save profile"}</Button>
  </div>;
}
