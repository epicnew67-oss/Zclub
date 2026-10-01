import { requireUser } from "@/lib/auth";
import { listAuditLog } from "@/lib/admin";
import { AdminAuditList } from "@/components/admin/admin-audit-list";

export const metadata = { title: "Admin · Audit" };

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; target?: string; page?: string }>;
}) {
  await requireUser("/admin/audit");
  const { action = "", target = "", page = "0" } = await searchParams;
  const offset = Math.max(parseInt(page, 10) || 0, 0) * 100;
  const rows = await listAuditLog({
    action: action.trim() || undefined,
    targetType: target.trim() || undefined,
    limit: 100,
    offset,
  }).catch(() => []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Audit <span className="text-gold">log</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every admin action — bans, settings edits, wallet adjustments, chat-log views, dispute
          resolutions — is recorded here. Filter by action substring or target type.
        </p>
      </header>

      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-muted-foreground">Action contains</span>
          <input
            name="action"
            defaultValue={action}
            placeholder="e.g. user.ban"
            className="h-10 w-48 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-muted-foreground">Target type</span>
          <input
            name="target"
            defaultValue={target}
            placeholder="booking / profile / setting"
            className="h-10 w-48 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg border border-gold/30 bg-gold/10 px-4 text-sm font-medium text-gold hover:bg-gold/20"
        >
          Filter
        </button>
      </form>

      <AdminAuditList rows={rows} />

      <nav className="mt-4 flex items-center justify-between text-sm">
        <a
          href={makePageLink(action, target, Math.max(offset / 100 - 1, 0))}
          aria-disabled={offset === 0}
          className={offset === 0 ? "pointer-events-none opacity-40" : ""}
        >
          ← Prev
        </a>
        <span className="text-muted-foreground">Page {offset / 100 + 1}</span>
        <a
          href={makePageLink(action, target, offset / 100 + 1)}
          aria-disabled={rows.length < 100}
          className={rows.length < 100 ? "pointer-events-none opacity-40" : ""}
        >
          Next →
        </a>
      </nav>
    </div>
  );
}

function makePageLink(action: string, target: string, page: number): string {
  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (target) params.set("target", target);
  if (page > 0) params.set("page", String(page));
  const qs = params.toString();
  return `/admin/audit${qs ? `?${qs}` : ""}`;
}