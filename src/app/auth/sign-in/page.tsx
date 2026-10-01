import type { Metadata } from "next";
import { AuthCard, SupabaseNotConfigured } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: PageProps<"/auth/sign-in">) {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  const { next } = await searchParams;
  const nextPath =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/account";

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to book your next call."
    >
      <SignInForm nextPath={nextPath} />
    </AuthCard>
  );
}
