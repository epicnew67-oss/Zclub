import type { Metadata } from "next";
import { AuthCard, SupabaseNotConfigured } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  return (
    <AuthCard
      title="Forgot password"
      subtitle="Enter your email and we'll send you a reset link."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
