import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireUser } from "@/lib/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import { AdminMobileNav, AdminSidebar, type AdminRole } from "@/components/admin/admin-sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthCard title="Admin" subtitle="Needs a configured Supabase — set .env.local.">
          <p className="text-sm text-muted-foreground">
            The admin tools unlock once Supabase is configured.
          </p>
        </AuthCard>
      </div>
    );
  }

  const { user } = await requireUser("/admin");
  const supabase = await createClient();
  const [
    { data: hasSupport },
    { data: hasFinance },
    { data: hasOwner },
  ] = await Promise.all([
    supabase.rpc("user_has_role", { _role: "support" }),
    supabase.rpc("user_has_role", { _role: "finance" }),
    supabase.rpc("user_has_role", { _role: "owner" }),
  ]);

  const roles: AdminRole[] = [];
  if (hasOwner) roles.push("owner");
  if (hasFinance) roles.push("finance");
  if (hasSupport) roles.push("support");

  if (roles.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <AuthCard title="Not authorized" subtitle="Support, finance, or owner role required.">
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "unknown"}. Ask an owner to grant you a role to access this area.
          </p>
        </AuthCard>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col">
      <AdminMobileNav roles={roles} />
      <div className="flex flex-1 w-full">
        <AdminSidebar roles={roles} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}