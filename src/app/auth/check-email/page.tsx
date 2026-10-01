import type { Metadata } from "next";
import Link from "next/link";
import { MailCheckIcon } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({
  searchParams,
}: PageProps<"/auth/check-email">) {
  const { email } = await searchParams;
  const address = typeof email === "string" && email.includes("@") ? email : null;

  return (
    <AuthCard
      title="Check your email"
      subtitle="We sent you a confirmation link to finish setting up your account."
    >
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
          <MailCheckIcon className="size-6 text-gold" />
        </div>
        {address ? (
          <p className="text-sm">
            <span className="font-medium text-foreground">{address}</span>
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Click the link in the email, then sign in. The link logs you in and
          confirms your address in one step.
        </p>
        <p className="text-xs text-muted-foreground">
          Local development: emails land in Mailpit at{" "}
          <a
            href="http://localhost:54324"
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline"
          >
            localhost:54324
          </a>
          .
        </p>
        <Button asChild variant="outline">
          <Link href="/auth/sign-in">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
