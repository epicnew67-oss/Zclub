"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon, Loader2Icon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (!isSupabaseConfigured()) return;
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignOut}
      disabled={signingOut}
      className="w-full sm:w-auto"
    >
      {signingOut ? (
        <>
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
          Signing out…
        </>
      ) : (
        <>
          <LogOutIcon data-icon="inline-start" />
          Sign out
        </>
      )}
    </Button>
  );
}
