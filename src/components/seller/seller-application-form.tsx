"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitSellerApplicationAction } from "@/app/become-a-seller/actions";

type Props = {
  termsVersion: string;
  defaultDisplayName: string;
};

export function SellerApplicationForm({ termsVersion, defaultDisplayName }: Props) {
  return <FormInner termsVersion={termsVersion} defaultDisplayName={defaultDisplayName} />;
}

function FormInner({ termsVersion, defaultDisplayName }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [gender, setGender] = useState("female");
  const [offering, setOffering] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(file: File | null) {
    setAvatarFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!agreed) {
      setError("You must agree to the rules and policies to continue.");
      return;
    }
    if (displayName.trim().length < 2) {
      setError("Display name must be 2–80 characters.");
      return;
    }
    if (offering.trim().length < 10) {
      setError("Tell buyers what you want to sell (10–1000 characters).");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You are not signed in.");

      // Upload avatar (if chosen) into seller-avatars/<uid>/… — the
      // owner-folder RLS lets the authenticated user write here. We
      // store the object path, not a public URL, because the bucket is
      // private; the server signs paths at read time.
      let avatarPath: string | null = null;
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop() ?? "jpg";
        const objectName = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("seller-avatars")
          .upload(objectName, avatarFile, {
            contentType: avatarFile.type || "image/jpeg",
            upsert: true,
          });
        if (uploadError) throw new Error(uploadError.message);
        avatarPath = objectName;
      }

      const result = await submitSellerApplicationAction({
        displayName: displayName.trim(),
        gender,
        offering: offering.trim(),
        avatarPath,
        termsVersion,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Card className="gold-border">
        <CardHeader>
          <CardTitle className="font-heading text-xl text-gold">Profile</CardTitle>
          <CardDescription className="text-muted-foreground">
            This is how buyers will find you. Use a clear photo and a name you&apos;re
            comfortable showing publicly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seller-avatar">Profile picture</Label>
            <div className="flex items-center gap-3">
              <div className="size-16 shrink-0 overflow-hidden rounded-2xl border border-gold/30 bg-muted/30">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No image</div>
                )}
              </div>
              <Input
                id="seller-avatar"
                type="file"
                accept="image/*"
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Images only. Neutral, non-explicit — this marketplace keeps it classy.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="seller-display-name">Display name</Label>
              <Input
                id="seller-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your public name"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seller-gender">Gender</Label>
              <select
                id="seller-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non_binary">Non-binary</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="seller-offering">What do you want to sell?</Label>
            <Textarea
              id="seller-offering"
              value={offering}
              onChange={(e) => setOffering(e.target.value)}
              placeholder="Describe your 1:1 video calls — topics, audience, style, any boundaries."
              rows={5}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">{offering.length} / 1000</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-gold">Rules & policies</CardTitle>
          <CardDescription>Please read carefully before applying.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-gold/20 bg-muted/20 p-3 text-sm text-muted-foreground">
            By applying you agree to our community guidelines and payout terms (terms
            version <Badge variant="gold-outline" className="ml-1">{termsVersion}</Badge>).
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-4 rounded border-input bg-transparent"
            />
            <span>
              I agree to the community rules and policies
              <span className="text-gold"> (required)</span>. I understand my
              application will be reviewed, and that repeated or false information may
              result in a ban.
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            We store the terms version, the time you agreed, and your IP for
            compliance when you submit.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t submit</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow">
        {submitting ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}