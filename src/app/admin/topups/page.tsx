import { requireUser } from "@/lib/auth";
import { listTopups } from "@/lib/admin";

export const metadata = { title: "Admin · Top-ups" };

export default async function AdminTopupsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireUser("/admin/topups");
  const { status } = await searchParams;
  const statuses = status ? status.split(",") : ["pending"];
  const rows = await listTopups(statuses).catch(() => []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Top-up <span className="text-gold">queue</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Read-only mirror of <code>/finance/topups</code>. The actual approve / reject lives there
          because the existing finance approve RPCs are tied to that surface. This page exists so
          finance has the same dashboard sidebar everywhere.
        </p>
      </header>

      <form className="mb-4 flex items-end gap-2" method="get">
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={status ?? "pending"}
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="credited">Credited</option>
            <option value="pending,approved,rejected,credited">All non-expired</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg border border-gold/30 bg-gold/10 px-4 text-sm font-medium text-gold hover:bg-gold/20"
        >
          Filter
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border/70 bg-surface/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Buyer</th>
              <th className="px-3 py-2">PKR</th>
              <th className="px-3 py-2">Tokens</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No top-ups match your filter.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="px-3 py-2 capitalize">{r.method}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.user_id.slice(0, 8)}…</td>
                <td className="px-3 py-2">{r.amount_pkr.toLocaleString()}</td>
                <td className="px-3 py-2">{r.tokens.toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.reference_code ?? r.transaction_id ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="rounded border border-border/60 px-1.5 py-0.5 capitalize">
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Approve / reject actions live at{" "}
        <a href="/finance/topups" className="text-gold underline">
          /finance/topups
        </a>
        .
      </p>
    </div>
  );
}