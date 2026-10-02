import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { listNotifications } from "@/lib/notifications";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Notifications" subtitle="Needs a configured Supabase.">
          <p className="text-sm text-muted-foreground">Set NEXT_PUBLIC_SUPABASE_URL in .env.local to enable.</p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/notifications");
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Sign in" subtitle="Sign in to view your notifications.">
          <p className="text-sm text-muted-foreground">
            Use the account menu in the top right to sign in or create one.
          </p>
        </AuthCard>
      </div>
    );
  }

  const rows = await listNotifications(100);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 md:px-8 md:py-16">
      <header className="mb-7 border-b border-gold/25 pb-7">
        <p className="editorial-kicker">Your account / Updates</p>
        <h1 className="mt-4 font-heading text-5xl leading-none font-normal md:text-6xl">
          Your <em className="text-gold-soft">notifications.</em>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Bookings, calls, payments, application results. New entries arrive in real time.
        </p>
      </header>
      <NotificationsList rows={rows} />
    </div>
  );
}
