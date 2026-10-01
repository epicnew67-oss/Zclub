import { requireUser } from "@/lib/auth";
import { getReportsOverview } from "@/lib/admin";

export const metadata = { title: "Admin · Reports" };

export default async function AdminReportsPage() {
  await requireUser("/admin/reports");
  const data = await getReportsOverview().catch(() => null);

  const funnelEntries = data ? Object.entries(data.funnel).sort(([, a], [, b]) => (b as number) - (a as number)) : [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Reports <span className="text-gold">/ analytics</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Read-only analytics: booking funnel, top sellers by 30-day released tokens, dispute rate.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Bookings · 30d" value={(data?.bookings_total_30d ?? 0).toLocaleString()} />
        <Stat
          label="Dispute rate · 30d"
          value={`${(Number(data?.dispute_rate_30d ?? 0) * 100).toFixed(2)}%`}
        />
        <Stat
          label="Top sellers · 30d"
          value={String(data?.top_sellers_30d.length ?? 0)}
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Booking funnel (all-time)
          </h2>
          <ul className="space-y-1 text-sm">
            {funnelEntries.map(([state, count]) => (
              <li key={state} className="flex items-center justify-between">
                <span className="capitalize text-muted-foreground">
                  {state.replace(/_/g, " ")}
                </span>
                <span className="font-medium">{count as number}</span>
              </li>
            ))}
            {funnelEntries.length === 0 ? (
              <li className="text-muted-foreground">No bookings yet.</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Top sellers · 30d (released tokens)
          </h2>
          <ul className="space-y-2 text-sm">
            {data?.top_sellers_30d.length ? (
              data.top_sellers_30d.map((s) => (
                <li key={s.seller_id} className="flex items-center justify-between">
                  <span>{s.display_name}</span>
                  <span className="text-muted-foreground">
                    {s.released_tokens_30d.toLocaleString()} tokens · {s.released_count_30d} calls
                  </span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No releases in the last 30 days.</li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/50 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 font-heading text-2xl font-semibold text-gold">{value}</div>
    </div>
  );
}