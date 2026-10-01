import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats, getDashboardCharts } from "@/lib/admin";

export const metadata = { title: "Admin · Dashboard" };

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/50 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 font-heading text-2xl font-semibold text-gold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return null;
  const w = 120;
  const h = 36;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p / max) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-gold" />
    </svg>
  );
}

export default async function AdminDashboardPage() {
  await requireUser("/admin");
  // Layout already enforces role; sanity log for extra safety.
  const supabase = await createClient();
  await supabase.rpc("user_has_role", { _role: "support" });

  const [stats, charts] = await Promise.all([
    getDashboardStats().catch(() => null),
    getDashboardCharts("30d").catch(() => null),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Operations <span className="text-gold">dashboard</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          30-day sales, 7-day new users, active sellers, bookings by state, and pending queues.
          Use the queues to drill into the work waiting for you.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sales · 30d (tokens)"
          value={stats ? stats.sales_30d_tokens.toLocaleString() : "—"}
        />
        <StatCard
          label="New users · 7d"
          value={stats ? stats.new_users_7d.toLocaleString() : "—"}
        />
        <StatCard
          label="Active sellers"
          value={stats ? stats.active_sellers.toLocaleString() : "—"}
        />
        <StatCard
          label="Bookings · 30d"
          value={stats ? Object.values(stats.bookings_by_state).reduce((a, b) => a + b, 0).toLocaleString() : "—"}
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Bookings by state · 30d
          </h2>
          <ul className="space-y-1 text-sm">
            {stats
              ? Object.entries(stats.bookings_by_state)
                  .sort(([, a], [, b]) => b - a)
                  .map(([state, count]) => (
                    <li key={state} className="flex items-center justify-between">
                      <span className="capitalize text-muted-foreground">{state}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))
              : null}
            {stats && Object.keys(stats.bookings_by_state).length === 0 ? (
              <li className="text-muted-foreground">No bookings in the last 30 days.</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Pending queues
          </h2>
          <ul className="space-y-2 text-sm">
            {stats ? (
              <>
                <li>
                  <Link href="/admin/listings" className="flex items-center justify-between hover:text-gold">
                    <span>Listings to review</span>
                    <span className="font-medium">{stats.pending_queues.listings}</span>
                  </Link>
                </li>
                <li>
                  <Link href="/admin/sellers" className="flex items-center justify-between hover:text-gold">
                    <span>Seller applications</span>
                    <span className="font-medium">{stats.pending_queues.applications}</span>
                  </Link>
                </li>
                <li>
                  <Link href="/finance/payouts" className="flex items-center justify-between hover:text-gold">
                    <span>Payouts pending</span>
                    <span className="font-medium">{stats.pending_queues.payouts}</span>
                  </Link>
                </li>
                <li>
                  <Link href="/admin/disputes" className="flex items-center justify-between hover:text-gold">
                    <span>Open disputes</span>
                    <span className="font-medium">{stats.pending_queues.disputes}</span>
                  </Link>
                </li>
              </>
            ) : (
              <li className="text-muted-foreground">Loading…</li>
            )}
          </ul>
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            New users · 30d
          </h3>
          <Sparkline points={(charts?.new_users ?? []).map((d) => d.count)} />
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Bookings · 30d
          </h3>
          <Sparkline points={(charts?.bookings ?? []).map((d) => d.count)} />
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Revenue · 30d (tokens)
          </h3>
          <Sparkline points={(charts?.revenue_tokens ?? []).map((d) => d.tokens)} />
        </div>
      </section>
    </div>
  );
}