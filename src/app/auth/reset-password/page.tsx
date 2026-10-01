import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthCard
        title="Reset password"
        subtitle="Set a new password for your account."
      >
        <ResetPasswordForm />
      </AuthCard>
    </Suspense>
  );
}
