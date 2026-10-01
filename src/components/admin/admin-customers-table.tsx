import {
  banUserButton,
  unbanUserButton,
  softDeleteUserButton,
  adjustWalletButton,
} from "@/app/admin/customers/actions";
import type { AdminUserSearchRow } from "@/lib/admin";

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toISOString().slice(0, 10);
}

export function AdminCustomersTable({ rows }: { rows: AdminUserSearchRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-surface/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Roles</th>
            <th className="px-3 py-2">Balance</th>
            <th className="px-3 py-2">Bookings</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Joined</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                No users match your search.
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium">{r.display_name ?? "—"}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}…</div>
              </td>
              <td className="px-3 py-2 text-xs">
                {(r.roles ?? []).map((role) => (
                  <span
                    key={role}
                    className="mr-1 inline-block rounded border border-border/60 px-1.5 py-0.5"
                  >
                    {role}
                  </span>
                ))}
              </td>
              <td className="px-3 py-2 font-medium">{r.balance.toLocaleString()}</td>
              <td className="px-3 py-2">{r.bookings_count}</td>
              <td className="px-3 py-2 text-xs">
                {r.soft_deleted_at ? (
                  <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                    Soft-deleted
                  </span>
                ) : r.is_banned ? (
                  <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                    Banned
                  </span>
                ) : (
                  <span className="rounded border border-border/60 px-1.5 py-0.5">Active</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.created_at)}</td>
              <td className="px-3 py-2 text-right">
                <BanRowActions row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BanRowActions({ row }: { row: AdminUserSearchRow }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <form action={banUserButton}>
        <input type="hidden" name="userId" value={row.id} />
        <input type="hidden" name="banned" value="true" />
        <button
          type="submit"
          disabled={!!row.is_banned || !!row.soft_deleted_at}
          className="rounded border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"
        >
          Ban
        </button>
      </form>
      <form action={unbanUserButton}>
        <input type="hidden" name="userId" value={row.id} />
        <button
          type="submit"
          disabled={!row.is_banned || !!row.soft_deleted_at}
          className="rounded border border-border/60 px-2 py-1 hover:border-gold/40 disabled:opacity-40"
        >
          Unban
        </button>
      </form>
      <form action={softDeleteUserButton}>
        <input type="hidden" name="userId" value={row.id} />
        <button
          type="submit"
          disabled={!!row.soft_deleted_at}
          className="rounded border border-border/60 px-2 py-1 hover:border-gold/40 disabled:opacity-40"
        >
          Soft delete
        </button>
      </form>
      <form action={adjustWalletButton}>
        <input type="hidden" name="userId" value={row.id} />
        <button
          type="submit"
          disabled={!!row.soft_deleted_at}
          className="rounded border border-gold/30 bg-gold/10 px-2 py-1 text-gold hover:bg-gold/20 disabled:opacity-40"
        >
          Adjust wallet
        </button>
      </form>
    </div>
  );
}