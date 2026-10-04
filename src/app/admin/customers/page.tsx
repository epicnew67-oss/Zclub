import { requireUser } from "@/lib/auth";
import { searchUsers } from "@/lib/admin";
import { AdminCustomersTable } from "@/components/admin/admin-customers-table";

export const metadata = { title: "Admin · Customers" };

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { supabase } = await requireUser("/admin/customers");
  const [{ data: owner }, { data: support }] = await Promise.all([supabase.rpc("user_has_role", { _role: "owner" }), supabase.rpc("user_has_role", { _role: "support" })]);
  const { q = "" } = await searchParams;
  const rows = await searchUsers(q, 50, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          <span className="text-gold">Customers</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Find a member, add tokens, or manage their account. Every change is recorded in the audit log.
        </p>
      </header>

      <form className="mb-4 flex items-center gap-2" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by display name…"
          className="h-10 w-full max-w-sm rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          className="h-10 rounded-lg border border-gold/30 bg-gold/10 px-4 text-sm font-medium text-gold hover:bg-gold/20"
        >
          Search
        </button>
      </form>

      <AdminCustomersTable rows={rows} canAdjust={!!owner} canManage={!!owner || !!support} />
    </div>
  );
}