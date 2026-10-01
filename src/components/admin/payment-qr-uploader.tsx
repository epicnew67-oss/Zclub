"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  ImagePlusIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const BUCKET = "payment-qr";
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;

function extensionFor(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function storagePathFromUrl(url: string): string | null {
  const markerIndex = url.indexOf(PUBLIC_MARKER);
  if (markerIndex === -1) return null;
  const path = url.slice(markerIndex + PUBLIC_MARKER.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

/**
 * QR image uploader for the payment settings. Uploads straight to the
 * `payment-qr` storage bucket (public read; owner/finance write, enforced
 * by bucket policies), then commits the resulting public URL through the
 * existing settings action. PNG/JPG/WebP up to 5 MB.
 */
export function PaymentQrUploader({
  provider,
  value,
  disabled = false,
  onCommit,
}: {
  provider: "jazzcash" | "easypaisa";
  value: string;
  disabled?: boolean;
  onCommit: (url: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "remove">(null);

  async function handleFile(file: File) {
    if (!ACCEPT_TYPES.includes(file.type)) {
      toast.error("QR must be a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("QR image must be 5 MB or smaller.");
      return;
    }
    if (file.size === 0) {
      toast.error("That file is empty — pick a valid QR image.");
      return;
    }

    setBusy("upload");
    try {
      const supabase = createClient();
      const path = `${provider}/qr-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${extensionFor(file.type)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = publicUrlData.publicUrl;

      const result = await onCommit(publicUrl);
      if (!result.ok) {
        // Don't orphan the file if settings didn't accept it.
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw new Error(result.error);
      }

      // Best-effort: drop the previous file (only if it lives in our bucket).
      const previousPath = value ? storagePathFromUrl(value) : null;
      if (previousPath && previousPath !== path) {
        void supabase.storage.from(BUCKET).remove([previousPath]).catch(() => {});
      }

      toast.success("QR code updated — customers see it immediately.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload failed — try again."
      );
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      const result = await onCommit(null);
      if (!result.ok) throw new Error(result.error);

      const path = value ? storagePathFromUrl(value) : null;
      if (path) {
        const supabase = createClient();
        void supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      }
      toast.success("QR code removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the QR code."
      );
    } finally {
      setBusy(null);
    }
  }

  const isBusy = busy !== null;

  return (
    <div className="space-y-2">
      <div className="text-xs tracking-wider text-muted-foreground uppercase">
        QR code
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {value ? (
          <div className="shrink-0 rounded-xl border border-gold/30 bg-gradient-to-b from-gold/[0.06] to-transparent p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt={`${provider} payment QR`}
              className="h-28 w-28 rounded-lg bg-muted/20 object-contain"
            />
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled || isBusy}
            onClick={() => inputRef.current?.click()}
            className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/40 bg-gold/[0.04] text-xs text-muted-foreground transition-colors hover:border-gold/70 hover:text-gold disabled:opacity-40"
          >
            <ImagePlusIcon className="size-5 text-gold" />
            Upload QR
          </button>
        )}

        <div className="flex flex-wrap items-start gap-2">
          <Button
            type="button"
            size="sm"
            variant={value ? "outline" : "default"}
            disabled={disabled || isBusy}
            onClick={() => inputRef.current?.click()}
            className={value ? "border-gold/40 text-gold hover:bg-gold/10" : "shadow-gold"}
          >
            {busy === "upload" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ImagePlusIcon data-icon="inline-start" />
            )}
            {value ? "Replace QR code" : "Upload QR code"}
          </Button>
          {value ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || isBusy}
              onClick={handleRemove}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {busy === "remove" ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Remove
            </Button>
          ) : null}
          <p className="w-full text-xs text-muted-foreground sm:max-w-56">
            PNG, JPG or WebP · up to 5 MB. Uploaded to secure storage; the
            manual payment screen shows it immediately.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
