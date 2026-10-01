import { ListPageSkeleton } from "@/components/layout/loading-skeletons";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6 md:py-12">
      <ListPageSkeleton cards={2} />
    </div>
  );
}
