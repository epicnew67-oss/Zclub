import type { AdminAuditRow } from "@/lib/admin";

function fmtDate(s: string): string {
  return new Date(s).toISOString().replace("T", " ").slice(0, 19);
}

export function AdminAuditList({ rows }: { rows: AdminAuditRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-surface/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No audit rows match your filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-surface/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Target</th>
            <th className="px-3 py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/40 align-top last:border-0">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {fmtDate(r.created_at)}
              </td>
              <td className="px-3 py-2">
                <div>{r.actor_name ?? "—"}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {r.actor_id ? r.actor_id.slice(0, 8) : "system"}
                </div>
              </td>
              <td className="px-3 py-2 font-medium text-gold">{r.action}</td>
              <td className="px-3 py-2 text-xs">
                <div>{r.target_type ?? "—"}</div>
                {r.target_id ? (
                  <div className="font-mono text-muted-foreground">{r.target_id.slice(0, 8)}…</div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-xs">
                <pre className="max-w-md whitespace-pre-wrap break-all rounded bg-background/40 p-2 font-mono text-[11px] text-muted-foreground">
                  {r.details ? JSON.stringify(r.details, null, 2) : "—"}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}