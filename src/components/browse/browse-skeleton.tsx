import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function BrowseSkeletonCard() {
  return (
    <Card variant="gold" className="overflow-hidden">
      <Skeleton className="aspect-[3/4] w-full rounded-none" />
      <div className="space-y-2 px-4 py-3">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-3 w-1/6" />
        </div>
      </div>
    </Card>
  );
}

export function BrowseSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <BrowseSkeletonCard key={i} />
      ))}
    </div>
  );
}