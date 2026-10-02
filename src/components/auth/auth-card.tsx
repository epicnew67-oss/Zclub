import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Centered card shell shared by all auth pages. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card variant="gold" className="w-full border-gold/35 p-1 md:p-2">
      <CardHeader className="p-4 md:p-5">
        <CardTitle className="font-heading text-3xl font-normal">{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent className="px-4 pb-4 md:px-5 md:pb-5">{children}</CardContent>
      {footer ? (
        <div className="border-t border-border/70 px-4 py-3 text-center text-sm text-muted-foreground md:px-5">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/** Shown instead of forms when Supabase env vars are missing. */
export function SupabaseNotConfigured() {
  return (
    <AuthCard
      title="Almost there"
      subtitle="Supabase isn't configured for this app yet."
    >
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Start or connect a Supabase project.</li>
        <li>
          Copy <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">.env.example</code>{" "}
          to{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">.env.local</code>{" "}
          and fill in the keys.
        </li>
        <li>Restart the dev server and come back.</li>
      </ol>
      <div className="mt-4">
        <Badge variant="gold-outline">Local dev: npx supabase start</Badge>
      </div>
    </AuthCard>
  );
}
