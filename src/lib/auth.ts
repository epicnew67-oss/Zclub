import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export { isSupabaseConfigured };

/**
 * Server-side auth guard for pages. Redirects signed-out users to
 * /auth/sign-in with ?next=<path> so login can send them back.
 */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  return { supabase, user };
}
