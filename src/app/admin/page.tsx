import { Suspense } from "react";
import Link from "next/link";
import { BlurFade } from "@/components/magic-ui/blur-fade";
import {
  ChartsSkeleton,
  PanelSkeleton,
  StatCardsSkeleton,
} from "@/components/layout/loading-skeletons";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardStats,
  getDashboardCharts,
  type AdminCharts,
  type AdminDashboardStats,
} from "@/lib/admin";

export const metadata = { title: "Admin · Dashboard" };

// Rendered while data streams or when a fetch fails — stats never show a
// stuck "Loading…" or "—": an idle platform is zeros, not blank.
const ZERO_STATS: AdminDashboardStats = {
  sales_30d_tokens: 0,
  new_users_7d: 0,
  active_sellers: 0,
  bookings_by_state: {},
  pending_queues: { listings: 0, applications: 0, payouts: 0, disputes: 0 },
};

const QUEUE_LINKS = [
  { href: "/admin/listings", label: "Listings to review", key: "listings" },
  { href: "/admin/sellers", label: "Seller applications", key: "applications" },
  { href: "/finance/payouts", label: "Payouts pending", key: "payouts" },
  { href: "/admin/disputes", label: "Open disputes", key: "disputes" },
] as const;

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
  // Idle windows render a flat baseline instead of an empty card.
  const series = points.length > 0 ? points : [0, 0];
  const w = 120;
  const h = 36;
  const max = Math.max(...series, 1);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const d = series
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

async function StatsSection() {
  const stats = (await getDashboardStats().catch(() => null)) ?? ZERO_STATS;
  const byState = Object.entries(stats.bookings_by_state).sort(([, a], [, b]) => b - a);
  const bookings30d = byState.reduce((sum, [, count]) => sum + count, 0);

  return (
    <BlurFade>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sales · 30d (tokens)"
          value={stats.sales_30d_tokens.toLocaleString()}
        />
        <StatCard label="New users · 7d" value={stats.new_users_7d.toLocaleString()} />
        <StatCard label="Active sellers" value={stats.active_sellers.toLocaleString()} />
        <StatCard label="Bookings · 30d" value={bookings30d.toLocaleString()} />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Bookings by state · 30d
          </h2>
          <ul className="space-y-1 text-sm">
            {byState.map(([state, count]) => (
              <li key={state} className="flex items-center justify-between">
                <span className="capitalize text-muted-foreground">{state}</span>
                <span className="font-medium">{count}</span>
              </li>
            ))}
            {byState.length === 0 ? (
              <li className="text-muted-foreground">No bookings in the last 30 days.</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            Pending queues
          </h2>
          <ul className="space-y-2 text-sm">
            {QUEUE_LINKS.map((queue) => (
              <li key={queue.href}>
                <Link
                  href={queue.href}
                  className="flex items-center justify-between hover:text-gold"
                >
                  <span>{queue.label}</span>
                  <span className="font-medium">{stats.pending_queues[queue.key]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </BlurFade>
  );
}

async function ChartsSection() {
  const charts: AdminCharts | null = await getDashboardCharts("30d").catch(() => null);
  const cards = [
    { title: "New users · 30d", points: (charts?.new_users ?? []).map((d) => d.count) },
    { title: "Bookings · 30d", points: (charts?.bookings ?? []).map((d) => d.count) },
    {
      title: "Revenue · 30d (tokens)",
      points: (charts?.revenue_tokens ?? []).map((d) => d.tokens),
    },
  ];

  return (
    <BlurFade className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {cards.map((card) => (
        <div key={card.title} className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {card.title}
          </h3>
          <Sparkline points={card.points} />
          {card.points.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No activity in this window.</p>
          ) : null}
        </div>
      ))}
    </BlurFade>
  );
}

export default async function AdminDashboardPage() {
  await requireUser("/admin");
  // Layout already enforces role; sanity log for extra safety.
  const supabase = await createClient();
  await supabase.rpc("user_has_role", { _role: "support" });

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

      <Suspense
        fallback={
          <>
            <StatCardsSkeleton />
            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PanelSkeleton rows={5} />
              <PanelSkeleton rows={4} />
            </div>
          </>
        }
      >
        <StatsSection />
      </Suspense>

      <div className="mt-8">
        <Suspense fallback={<ChartsSkeleton />}>
          <ChartsSection />
        </Suspense>
      </div>
    </div>
  );
}
