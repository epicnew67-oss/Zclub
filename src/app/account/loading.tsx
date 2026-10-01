import { ListPageSkeleton } from "@/components/layout/loading-skeletons";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 md:px-6 md:py-16">
      <ListPageSkeleton cards={2} />
    </div>
  );
}
