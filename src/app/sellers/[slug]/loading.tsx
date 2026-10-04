import { Skeleton } from "@/components/ui/skeleton";
import { BrowseSkeletonGrid } from "@/components/browse/browse-skeleton";

export default function Loading() {
  return <div role="status" aria-label="Loading seller profile" className="mx-auto max-w-7xl space-y-10 px-5 py-10 md:px-10"><div className="grid gap-10 md:grid-cols-2"><Skeleton className="aspect-[4/5] w-full" /><div className="space-y-6 py-12"><Skeleton className="h-4 w-32" /><Skeleton className="h-16 w-3/4" /><Skeleton className="h-28 w-full" /><Skeleton className="h-12 w-48" /></div></div><BrowseSkeletonGrid count={4} /></div>;
}
