import { ListPageSkeleton } from "@/components/layout/loading-skeletons";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <ListPageSkeleton cards={2} />
    </div>
  );
}
