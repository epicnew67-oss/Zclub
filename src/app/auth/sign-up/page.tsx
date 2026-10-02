import { safeRedirectPath } from "@/lib/safe-redirect";
import type { Metadata } from "next";
import { AuthCard, SupabaseNotConfigured } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: PageProps<"/auth/sign-up">) {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  const { next } = await searchParams;
  const nextPath = safeRedirectPath(next);

  return (
    <AuthCard
      title="Join the club"
      subtitle="Create an account to browse and book 1:1 calls."
    >
      <SignUpForm nextPath={nextPath} />
    </AuthCard>
  );
}
