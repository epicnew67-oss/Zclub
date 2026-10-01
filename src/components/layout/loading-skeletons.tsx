import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared route-level loading skeletons (used by loading.tsx files) and
 * in-page Suspense fallbacks so dashboard section switches never show a
 * blank frame — the shell paints instantly, data streams in.
 */

export function PageHeaderSkeleton({ withSubtitle = true }: { withSubtitle?: boolean }) {
  return (
    <div className="mb-6">
      <Skeleton className="h-8 w-56" />
      {withSubtitle ? <Skeleton className="mt-3 h-4 w-full max-w-xl" /> : null}
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border/70 bg-surface/50 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
      <Skeleton className="h-4 w-36" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border/70 bg-surface/40 p-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <PageHeaderSkeleton />
      <StatCardsSkeleton />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelSkeleton rows={5} />
        <PanelSkeleton rows={4} />
      </div>
      <div className="mt-8">
        <ChartsSkeleton />
      </div>
    </div>
  );
}

export function ListPageSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="space-y-6">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="rounded-lg border border-border/70 bg-surface/40 p-6">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="mt-2 h-4 w-64" />
            <div className="mt-5 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
