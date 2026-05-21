export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    />
  );
}

const SKELETON_LINE_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {SKELETON_LINE_KEYS.slice(0, lines).map((key, i, arr) => (
        <Skeleton key={key} className={`h-3 ${i === arr.length - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="space-y-2 p-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}
