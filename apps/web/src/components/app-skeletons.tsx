import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex min-h-svh">
      <span className="sr-only">Loading…</span>
      <div className="bg-sidebar hidden w-60 shrink-0 space-y-3 border-r p-3 md:block">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-14 border-b" />
        <div className="space-y-4 px-4 py-6 md:px-8 md:py-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
