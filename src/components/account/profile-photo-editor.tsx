"use client";

/* eslint-disable @next/next/no-img-element -- The preview may be a local blob URL. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { applyPendingSignupPhoto, uploadProfilePhoto, validateProfilePhoto } from "@/lib/profile-photo-client";
import { Button } from "@/components/ui/button";

export function ProfilePhotoEditor({ email, name, initialUrl }: {
  email: string;
  name: string;
  initialUrl: string | null;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void applyPendingSignupPhoto(email).then((saved) => {
      if (saved && mounted) router.refresh();
    }).catch(() => {
      if (mounted) toast.error("Your sign-up photo could not be saved. Choose it here again.");
    });
    return () => { mounted = false; };
  }, [email, router]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(selected: File | null) {
    if (!selected) return;
    const invalid = validateProfilePhoto(selected);
    if (invalid) { toast.error(invalid); return; }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    try {
      await uploadProfilePhoto(file);
      setFile(null);
      setPreview(null);
      toast.success("Profile photo updated.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-gold/40 bg-gold/10 text-xl font-semibold text-gold">
        {preview || initialUrl ? <img src={preview ?? initialUrl ?? ""} alt="Your profile" className="size-full object-cover" /> : name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate font-medium text-foreground">{name}</p>
        <p className="truncate text-sm text-muted-foreground">{email}</p>
        <label htmlFor="account-photo" className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-gold hover:underline">
          <CameraIcon className="size-4" aria-hidden="true" /> Change photo
        </label>
        <input id="account-photo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
        <p className="text-xs text-muted-foreground">JPG, PNG, or WebP · up to 5 MB.</p>
        {file ? <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2Icon className="size-4 animate-spin" /> : null} Save photo</Button> : null}
      </div>
    </div>
  );
}
